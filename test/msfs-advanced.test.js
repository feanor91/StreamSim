import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createMsfs } from '../server/msfs.js';
import { runAction, applyOperation } from '../server/actions.js';
import { startDeckServer } from '../server/app.js';
import { FBW_PRESETS, isValidSimvar, normalizeVar, MSFS_EVENT_LABELS } from '../shared/msfs.js';
import { fakeSimConnect } from './fake-simconnect.js';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, warn() {}, error() {} };

test('opérations : fixer, basculer, ajouter (borné ou bouclé)', async () => {
  let v = 0;
  const run = (a) => applyOperation(a, async () => v, async (x) => (v = x));
  await run({ op: 'set', value: 2 });
  assert.equal(v, 2);
  await run({ op: 'toggle' });
  assert.equal(v, 1);
  await run({ op: 'toggle' });
  assert.equal(v, 0);
  await run({ op: 'add', value: 5, max: 3 });
  assert.equal(v, 3);
  v = 355;
  await run({ op: 'add', value: 10, min: 0, max: 360, wrap: true });
  assert.equal(v, 5);
});

test('variables L: : validation et normalisation', () => {
  assert.ok(isValidSimvar('L:A32NX_FCU_AP_1_LIGHT_ON'));
  assert.ok(isValidSimvar('L:rafale_mfd_left_mode'));
  assert.equal(isValidSimvar('L:bad name!'), false);
  assert.equal(normalizeVar('l:Rafale_X'), 'L:Rafale_X');
  assert.equal(normalizeVar('nav obs:1'), 'NAV OBS:1');
});

test('écriture d’une variable L: et bascule 0 ↔ 1', async () => {
  const sim = fakeSimConnect({ vars: { 'L:RAFALE_MASTER_ARM': 0 } });
  const msfs = createMsfs({ log: quiet, load: async () => sim.lib });
  msfs.start();
  await tick();
  const action = { type: 'msfs', kind: 'var', var: 'L:RAFALE_MASTER_ARM', op: 'toggle' };
  await runAction({}, action, 0, { msfs });
  assert.equal(sim.values['L:RAFALE_MASTER_ARM'], 1);
  await tick(5);
  await runAction({}, action, 0, { msfs });
  assert.equal(sim.values['L:RAFALE_MASTER_ARM'], 0);
  msfs.close();
});

test('Input Events : liste, écriture, pas successifs rapides', async () => {
  const sim = fakeSimConnect({ inputs: [{ name: 'LIGHTING_LANDING_1', value: 0 }, { name: 'AUTOPILOT_KNOB_HEADING', value: 90 }] });
  const msfs = createMsfs({ log: quiet, load: async () => sim.lib });
  msfs.start();
  await tick();
  const list = await msfs.inputEvents();
  assert.deepEqual(list.map((i) => i.name), ['AUTOPILOT_KNOB_HEADING', 'LIGHTING_LANDING_1']);
  await runAction({}, { type: 'msfs', kind: 'input', input: 'LIGHTING_LANDING_1', op: 'toggle' }, 0, { msfs });
  assert.equal(sim.inputValues.LIGHTING_LANDING_1, 1);
  // Trois crans rapides : chacun repart de la valeur écrite par le précédent.
  const step = { type: 'msfs', kind: 'input', input: 'AUTOPILOT_KNOB_HEADING', op: 'add', value: 1, min: 0, max: 360, wrap: true };
  for (let i = 0; i < 3; i++) await runAction({}, step, 0, { msfs });
  assert.equal(sim.inputValues.AUTOPILOT_KNOB_HEADING, 93);
  await assert.rejects(msfs.setInput('INEXISTANT', 1), /pas de commande/);
  assert.equal(msfs.status.aircraft, 'Faux_Rafale');
  msfs.close();
});

test('catalogue A320 FlyByWire cohérent', () => {
  for (const p of FBW_PRESETS) {
    const events = p.action.type === 'dial' ? [p.action.inc, p.action.dec, p.action.press, p.action.hold] : p.action.actions;
    for (const e of events.filter(Boolean)) assert.ok(MSFS_EVENT_LABELS[e.event], `événement non catalogué : ${e.event}`);
    const vars = [p.action.sync?.simvar, p.action.display?.simvar, p.action.display?.dashes, p.action.display?.managed].filter(Boolean);
    for (const v of vars) assert.ok(isValidSimvar(v), v);
  }
});

test('serveur : FCU A320 (voyants, afficheur, enfoncer / tirer) et bascule sur Input Event', async () => {
  const sim = fakeSimConnect({ inputs: [{ name: 'RAFALE_GEAR_LEVER', value: 0 }] });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-fbw-'));
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfsLoader: async () => sim.lib, log: quiet });
  const url = `http://127.0.0.1:${deck.port}`;
  const get = () => fetch(`${url}/api/config`).then((r) => r.json());
  const post = (p, data) =>
    fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json());
  const preset = (label) => FBW_PRESETS.find((p) => p.label === label);
  try {
    await tick();
    const { config } = await get();
    const pg = config.profiles[0].pages[0];
    const key = (p) => ({ ...p.face, ...(p.alt ? { alt: p.alt } : {}), action: p.action });
    pg.keys[5] = key(preset('FCU : AP1'));
    pg.keys[6] = key(preset('Auto-freinage MED'));
    pg.keys[7] = key(preset('FCU : bouton HDG'));
    pg.keys[8] = {
      title: 'Train',
      action: { type: 'toggle', same: true, sync: { input: 'RAFALE_GEAR_LEVER' }, actions: [{ type: 'msfs', kind: 'input', input: 'RAFALE_GEAR_LEVER', op: 'toggle' }] },
    };
    await fetch(`${url}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
    await tick(60);
    const base = { profileId: 'default', pageId: pg.id };
    const sk = (i) => `default/${pg.id}/${i}`;

    // Voyant AP1 allumé ; auto-freinage : MED seulement si le mode vaut 2.
    sim.emitValue('L:A32NX_FCU_AP_1_LIGHT_ON', 1);
    sim.emitValue('L:A32NX_AUTOBRAKES_ARMED_MODE', 3);
    let states = (await get()).states;
    assert.equal(states[sk(5)], 1);
    assert.equal(states[sk(6)], undefined);
    sim.emitValue('L:A32NX_AUTOBRAKES_ARMED_MODE', 2);
    assert.equal((await get()).states[sk(6)], 1);

    // Afficheur HDG : valeur, tirets, point managé.
    sim.emitValue('L:A32NX_FCU_AFS_DISPLAY_HDG_TRK_VALUE', 45);
    sim.emitValue('L:A32NX_FCU_AFS_DISPLAY_HDG_TRK_MANAGED', 1);
    const cfg = await get();
    assert.equal(cfg.values[sk(7)], 45);
    assert.equal(cfg.flags[sk(7)].managed, true);

    // Bouton HDG : appui = enfoncer, appui long = tirer.
    await post('/api/press', { ...base, index: 7, input: { kind: 'press' } });
    await post('/api/press', { ...base, index: 7, input: { kind: 'hold' } });
    assert.deepEqual(sim.sentEvents().slice(-2).map((e) => e[0]), ['A32NX.FCU_HDG_PUSH', 'A32NX.FCU_HDG_PULL']);

    // Bascule reliée à un Input Event : écriture puis état relu dans le simulateur.
    await post('/api/press', { ...base, index: 8 });
    await tick(30);
    assert.equal(sim.inputValues.RAFALE_GEAR_LEVER, 1);
    assert.equal((await get()).states[sk(8)], 1);
    sim.emitInput('RAFALE_GEAR_LEVER', 0); // levier remonté à la souris dans le cockpit
    await tick(10);
    assert.equal((await get()).states[sk(8)], undefined);

    // Explorateur : liste des commandes de l'avion chargé, lecture d'une valeur.
    const list = await fetch(`${url}/api/msfs/inputs`).then((r) => r.json());
    assert.equal(list.aircraft, 'Faux_Rafale');
    assert.deepEqual(list.inputs.map((i) => i.name), ['RAFALE_GEAR_LEVER']);
    assert.equal((await post('/api/msfs/read', { var: 'L:A32NX_AUTOBRAKES_ARMED_MODE' })).value, 2);
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('Rafale : préréglages et nom de l’avion (MSFS 2024)', async () => {
  const { RAFALE_PRESETS } = await import('../shared/msfs.js');
  const { aircraftFromPath } = await import('../server/msfs.js');
  for (const p of RAFALE_PRESETS) {
    assert.ok(p.action.sync?.input, p.label);
    const steps = p.action.actions.flatMap((a) => (a.type === 'multi' ? a.steps : [a]));
    for (const st of steps) assert.ok(st.type === 'msfs' && st.kind === 'input' && /^[A-Z0-9_]+$/.test(st.input), `${p.label} : ${st.input}`);
  }
  const { RAFALE_COCKPIT_PRESETS } = await import('../shared/msfs.js');
  for (const p of RAFALE_COCKPIT_PRESETS) {
    const a = p.action;
    const vars = [a.sync?.simvar, a.display?.simvar, ...(a.steps ?? []).map((s) => s.var), ...(a.actions ?? []).map((s) => s.var), a.inc?.var, a.dec?.var].filter(Boolean);
    const codes = [a, ...(a.steps ?? []), ...(a.actions ?? []), a.inc, a.dec, a.press].filter((s) => s?.kind === 'code').map((s) => s.code);
    assert.ok(vars.length || codes.length, p.label);
    for (const c of codes) assert.match(c, /AZP_RAF_/, p.label);
    for (const v of vars) assert.ok(isValidSimvar(v) && (v.startsWith('L:AZP_RAF_') || v === 'APU SWITCH'), `${p.label} : ${v}`);
  }
  // Commandes documentées par AzurPoly (« Custom variables and events ») toutes présentes.
  const allCodes = JSON.stringify(RAFALE_COCKPIT_PRESETS);
  for (const ev of ['AIR_CONDITIONING_TOGGLE_PRESSED', 'ALARMS_ACKNOWLEDGE', 'AP_ALT_VAR_INC', 'AP_ALT_VAR_DEC', 'AP_AT_TOGGLE',
    'AP_MAIN_MODE_TOGGLE', 'AP_TF_TOGGLE', 'AVIONICS_MF_KNOB_INC', 'AVIONICS_MF_KNOB_DEC', 'AVIONICS_MF_KNOB_PUSHED',
    'AVIONICS_VISUALISATION_KNOB_RIGHT_PUSHED', 'ELECTRICAL_MAIN_SOURCE_KNOB_INC', 'ENGINE_TGA_TOGGLE_PRESSED',
    'VTLD_SWITCH_MOVED_HSI', 'VTLD_SWITCH_MOVED_FUEL', 'VTLD_SWITCH_MOVED_ECM', 'VTLD_SWITCH_MOVED_SITAC', 'VTLG_SWITCH_MOVED_INFO',
    'WEAPONS_EMERGENCY_JETTISON_PRESSED', 'WEAPONS_GUN_REFILL']) assert.ok(allCodes.includes(`(>H:AZP_RAF_${ev})`), ev);
  // Visuels de touche (APU, ECS, 5K) : fichiers présents, un visuel par position du sélecteur 5K.
  const { existsSync } = await import('node:fs');
  const faceIcons = RAFALE_COCKPIT_PRESETS.flatMap((p) => [p.face.icon, p.alt?.icon, ...(p.action.display?.images ?? [])]).filter((i) => i?.includes('/faces/'));
  assert.equal(faceIcons.length >= 9, true);
  for (const i of faceIcons) assert.ok(existsSync(new URL(`..${i.replace('/public/', '/public/')}`, import.meta.url)), i);
  const k5 = RAFALE_COCKPIT_PRESETS.find((p) => p.face.title === '5K');
  assert.equal(k5.action.display.images.length, 6);
  assert.deepEqual(k5.face.span, { w: 2, h: 2 });
  assert.equal(k5.action.display.simvar, 'L:AZP_RAF_ELECTRICAL_MAIN_SOURCE_KNOB_ANIM');
  assert.equal(k5.action.display.values.length, 6);
  assert.equal(RAFALE_COCKPIT_PRESETS.find((p) => p.face.title === 'APU').action.sync.simvar, 'APU SWITCH');
  const aec = RAFALE_COCKPIT_PRESETS.find((p) => p.label.includes('auxiliaire gauche')).action;
  assert.equal(aec.inc.code, '(L:AZP_RAF_ENGINE_AUXILIARY_LEVER_POS:1, Number) 1 + 3 min (>L:AZP_RAF_ENGINE_AUXILIARY_LEVER_POS:1, Number)');
  assert.equal(aec.dec.code, '(L:AZP_RAF_ENGINE_AUXILIARY_LEVER_POS:1, Number) 1 - 0 max (>L:AZP_RAF_ENGINE_AUXILIARY_LEVER_POS:1, Number)');
  assert.deepEqual(aec.display.labels, ['STOP', 'IDLE', 'NORM', 'FIX']);
  assert.equal(aec.display.images.length, 4);
  assert.equal(aircraftFromPath('C:\\MSFS\\Community\\azurpoly\\SimObjects\\Airplanes\\Rafale\\presets\\azurpoly\\rafale-c\\config\\aircraft.cfg'), 'rafale-c');
  assert.equal(aircraftFromPath('SimObjects\\Airplanes\\Faux_Rafale\\aircraft.cfg'), 'Faux_Rafale');
});

test('Rafale : caches posés puis retirés, état lu dans le simulateur', async () => {
  const { RAFALE_PRESETS, RAFALE_COVERS } = await import('../shared/msfs.js');
  const sim = fakeSimConnect({ inputs: RAFALE_COVERS.map((name) => ({ name, value: 0 })) });
  const msfs = createMsfs({ log: quiet, load: async () => sim.lib });
  msfs.start();
  await tick();
  const covers = RAFALE_PRESETS.find((p) => p.label.startsWith('Caches'));
  await runAction({}, covers.action.actions[0], 0, { msfs });
  assert.ok(RAFALE_COVERS.every((n) => sim.inputValues[n] === 1));
  await runAction({}, covers.action.actions[1], 0, { msfs });
  assert.ok(RAFALE_COVERS.every((n) => sim.inputValues[n] === 0));
  msfs.close();
});

test('Rafale : molette de luminosité bornée', async () => {
  const { RAFALE_COCKPIT_PRESETS } = await import('../shared/msfs.js');
  const sim = fakeSimConnect({ vars: { 'L:AZP_RAF_AVIONICS_BRIGHTNESS_VTLG': 0.9 } });
  const msfs = createMsfs({ log: quiet, load: async () => sim.lib });
  msfs.start();
  await tick();
  const dial = RAFALE_COCKPIT_PRESETS.find((p) => p.label === 'Luminosité VTLG');
  // Écrans du Rafale : 0 à 1 (1 = 100 %), pas de 5 %, sans dépasser 1.
  await runAction({}, dial.action.dec, 0, { msfs });
  assert.equal(sim.values['L:AZP_RAF_AVIONICS_BRIGHTNESS_VTLG'], 0.85);
  for (let i = 0; i < 5; i++) await runAction({}, dial.action.inc, 0, { msfs });
  assert.equal(sim.values['L:AZP_RAF_AVIONICS_BRIGHTNESS_VTLG'], 1);
  const { formatDisplay } = await import('../shared/controls.js');
  assert.equal(formatDisplay(1, dial.action.display), '100 %');
  assert.equal(formatDisplay(0.35, dial.action.display), '35 %');
  msfs.close();
});

test('fin de vol : connexion coupée pendant un abonnement, sans erreur non traitée', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const sim = fakeSimConnect({ inputs: [{ name: 'LANDING_GEAR_GEAR', value: 1 }] });
  const msfs = createMsfs({ log: quiet, load: async () => sim.lib });
  msfs.start();
  await tick();
  msfs.watch([{ input: 'LANDING_GEAR_GEAR' }]);
  sim.handle.emit('quit'); // le simulateur coupe la connexion au milieu de l'abonnement
  await tick(100);
  assert.equal(msfs.status.connected, false);
  await assert.rejects(msfs.setInput('LANDING_GEAR_GEAR', 0), /pas connecté/);
  process.off('unhandledRejection', onUnhandled);
  msfs.close();
  assert.deepEqual(unhandled, []);
});

test('code avionique par MobiFlight WASM (événements H: du Rafale)', async () => {
  const logs = [];
  const log = { log: (m) => logs.push(m), warn: (m) => logs.push(m), error() {} };
  const sim = fakeSimConnect({ vars: { 'L:AZP_RAF_VTLG_PAGE_SWITCH_L': 0 } });
  const msfs = createMsfs({ log, load: async () => sim.lib });
  msfs.start();
  await tick();
  const code = '(>H:AZP_RAF_VTLG_SWITCH_MOVED_ALARMS) (>H:AZP_RAF_ALARMS_ACKNOWLEDGE) 1 (>L:AZP_RAF_VTLG_PAGE_SWITCH_L, Boolean)';
  await runAction({}, { type: 'msfs', kind: 'code', code }, 0, { msfs });
  await tick(30);
  assert.deepEqual(sim.mfCommands, ['MF.Ping', `MF.SimVars.Set.${code}`]);
  assert.equal(sim.values['L:AZP_RAF_VTLG_PAGE_SWITCH_L'], 1);
  assert.ok(logs.some((m) => /MobiFlight WASM détecté/.test(m)));
  await assert.rejects(runAction({}, { type: 'msfs', kind: 'code', code: '  ' }, 0, { msfs }), /Aucun code/);
  msfs.close();
});

test('chargement d’un avion : commandes de cockpit relues jusqu’à ce que MSFS réponde', async () => {
  const warnings = [];
  const log = { log() {}, warn: (m) => warnings.push(m), error() {} };
  const sim = fakeSimConnect({ inputs: [{ name: 'LANDING_GEAR_GEAR', value: 1 }] });
  const got = [];
  const msfs = createMsfs({ log, load: async () => sim.lib, onInput: (n, v) => got.push([n, v]), inputListTimeoutMs: 40, inputRetryMs: 30 });
  msfs.start();
  await tick();
  sim.inputsReady = false; // l'avion se charge : MSFS refuse de lister ses commandes
  msfs.watch([{ input: 'LANDING_GEAR_GEAR' }]);
  sim.handle.emit('eventFilename', { clientEventId: 900001, fileName: 'SimObjects\\Airplanes\\Rafale\\config\\aircraft.cfg' });
  await tick(3150);
  sim.inputsReady = true; // chargement terminé
  await tick(200);
  assert.deepEqual(got.at(-1), ['LANDING_GEAR_GEAR', 1]);
  assert.equal(warnings.filter((w) => /aucune commande/.test(w)).length <= 1, true);
  msfs.close();
});

test('coupure « EPIPE » : reconnexion automatique au simulateur', async () => {
  const sim = fakeSimConnect({});
  let opens = 0;
  const lib = { ...sim.lib, open: async (...a) => (opens++, sim.lib.open(...a)) };
  const msfs = createMsfs({ log: quiet, load: async () => lib, retryMs: 30 });
  msfs.start();
  await tick();
  assert.equal(msfs.status.connected, true);
  sim.handle.emit('error', Object.assign(new Error('read EPIPE'), { code: 'EPIPE' }));
  assert.equal(msfs.status.connected, false);
  await tick(120);
  assert.equal(msfs.status.connected, true);
  assert.equal(opens, 2);
  msfs.close();
});

test('journal : une exception SimConnect indique la commande qui l’a provoquée', async () => {
  const warnings = [];
  const sim = fakeSimConnect({});
  let n = 100;
  // Comme node-simconnect : chaque envoi renvoie le numéro du paquet.
  const origSend = sim.handle.transmitClientEvent;
  sim.handle.mapClientEventToSimEvent = ((orig) => (...a) => (orig(...a), ++n))(sim.handle.mapClientEventToSimEvent);
  sim.handle.transmitClientEvent = (...a) => (origSend(...a), ++n);
  const msfs = createMsfs({ log: { log() {}, warn: (m) => warnings.push(m), error() {} }, load: async () => sim.lib });
  msfs.start();
  await tick();
  await msfs.send('GEAR_TOGGLE');
  sim.handle.emit('exception', { exceptionName: 'UNRECOGNIZED_ID', sendId: n });
  assert.match(warnings.at(-1), /paquet \d+ : transmitClientEvent\(/);
  msfs.close();
});

test('Rafale : molette de visualisation (événements H: en tournant, validation à l’appui)', async () => {
  const { RAFALE_COCKPIT_PRESETS } = await import('../shared/msfs.js');
  const sim = fakeSimConnect({});
  const msfs = createMsfs({ log: quiet, load: async () => sim.lib, mfGapMs: 2 });
  msfs.start();
  await tick();
  const knob = RAFALE_COCKPIT_PRESETS.find((p) => p.label === 'Molette de visualisation gauche').action;
  // Trois crans dans le même sens : chacun doit être vu par le module (commande identique répétée).
  for (let i = 0; i < 3; i++) await runAction({}, knob.inc, 0, { msfs });
  await runAction({}, knob.dec, 0, { msfs });
  await runAction({}, knob.press, 0, { msfs });
  const inc = 'MF.SimVars.Set.(>H:AZP_RAF_AVIONICS_VISUALISATION_KNOB_LEFT_INC)';
  assert.deepEqual(sim.mfCommands.slice(1), [
    inc,
    inc,
    inc,
    'MF.SimVars.Set.(>H:AZP_RAF_AVIONICS_VISUALISATION_KNOB_LEFT_DEC)',
    'MF.SimVars.Set.(>H:AZP_RAF_AVIONICS_VISUALISATION_KNOB_LEFT_PUSHED)',
  ]);
  msfs.close();
});
