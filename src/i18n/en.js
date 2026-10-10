// English strings of the interface (src/i18n.js). {name} is a placeholder filled by t(). Keys are shared with uk.js.
export default {
  // ---- Crazy Tuk HUD and the summary
  'kind.exact': 'Exact!', 'kind.good': 'Good', 'kind.ok': 'Hit', 'kind.missed': 'Missed',
  'hud.kmh': 'km/h', 'hud.m': 'm', 'hud.km': 'km', 'hud.s': 's', 'hud.go': 'GO!',
  'hud.offRoad': 'OFF THE ROAD! Back to the street', 'hud.atStake': ' +{v} at stake', 'hud.finish': 'FINISH!', 'hud.gateMissed': 'gate missed', 'hud.finishGate': 'Finish: {v}',
  'sum.timeout': "Time's up", 'sum.finish': 'Finish!', 'sum.record': '🏆 New record!', 'sum.yourBest': 'Your best: {v} · {stars}',
  'sum.time': 'Time', 'sum.timeLeft': ' · {s} s left → +{v}', 'sum.gates': 'Gates', 'sum.gatesLine': 'exact {e} · good {g} · hit {o} · missed {m} of {n}',
  'sum.max': 'Top speed', 'sum.hits': 'Hits', 'sum.offRoad': 'Off the road', 'sum.offRoadLine': '{n} times · {s} s · {v} burnt',
  'sum.skill': 'Skill', 'sum.skillLine': 'smashed {sm} · near misses {nm} · drift {d} s → {v}', 'sum.dist': 'Distance', 'sum.notReached': 'not reached',
  'sum.again': 'Again', 'sum.tour': 'Real tour', 'sum.book': 'Book the real tour', 'sum.trial': 'Test drive · ',
  'sum.note': "It's a game. On the real tour we don't break walls, but the thrill is the same 😉",
  // ---- events on the way
  'ev.hit': 'Hit!', 'ev.hitBurn': 'Hit! −{v}', 'ev.offRoadOn': 'Off the road!', 'ev.offRoadOff': 'Back on the road', 'ev.nearMiss': 'Near miss! +{v}',
  'ev.drift': 'Drift {s} s! +{v}', 'ev.stuck': 'Back onto the road −3 s', 'ev.smashed': 'Smashed{x}! +{v}',
  // ---- messages
  'msg.tourUnavailable': 'Tour unavailable', 'msg.levelNotFound': 'Crazy Tuk: level not found', 'msg.whatsapp': 'The WhatsApp number is not set yet (src/config.js)',
  'msg.againRun': 'Press again to restart the run', 'msg.againTour': 'Press again to start the tour', 'msg.backOnRoad': 'Back on the road',
  'msg.trial': 'Test drive. Back to the editor: menu ≡ → “Level editor” (PC: key E)', 'msg.tilt': 'Cab tilt: {v}', 'msg.stress': 'Load ×{n}', 'msg.stressOff': 'Load off',
  'msg.hz': 'Refresh 72 Hz (was {v} FPS)', 'msg.vignette': 'Vignette: {v}', 'msg.recentered': 'Seat re-centred', 'msg.steerHands': 'Steering: hands (hold both grips)', 'msg.steerStick': 'Steering: stick',
  'msg.nitroTo': 'NITRO! up to {v} km/h', 'msg.nitroCharge': 'Nitro charging: {s} s', 'msg.nitroForward': 'Nitro only when driving forward', 'msg.hitReset': 'Hit! Back onto the road',
  'vr.hintHands': 'Hold both grips to steer, twist the right grip for gas', 'vr.hintStick': 'Gas: right trigger, brake: left trigger',
  'vr.center': 'Come back to the centre', 'vr.hands': 'Keep your hands to the sides', 'vr.grab': 'Grab the bar (grip)',
  // ---- records
  'best.text': 'Best: {stars} · {v} · {t}', 'best.arcade': 'Crazy Tuk record: {v} · {stars} · {t}', 'best.none': 'Crazy Tuk: no record yet', 'best.noneShort': 'No record yet. Be the first!',
  // ---- the real tour panel
  'tour.boardingLine': 'Pick-up · {v}', 'tour.waiting': 'Tourists waiting: {v}', 'tour.seating': 'Tourists getting in…', 'tour.approach': 'Approach slowly and stop in the yellow zone',
  'tour.leaving': 'Tourists getting off…', 'tour.factAhead': 'Fact on the way · stop {a}/{b} next', 'tour.finishLine': 'Finish — back to the hotel', 'tour.stop': 'Stop {a}/{b}',
  'tour.moodEvents': 'Mood {m} %{ev}', 'tour.noEvents': ' — not a single harsh moment!', 'tour.passes': ' · facts on the way {a}/{b}', 'tour.wasBest': 'Previous best: {v}', 'tour.firstSaved': 'First result saved',
  'tour.newTourBtn': '{btn} — new tour', 'tour.newTourBelow': 'New tour — button below',
  'tour.waitSeated': 'Wait until everyone is seated', 'tour.canGo': 'You can go', 'tour.next': ' · Next: {v}', 'tour.slowStop': 'Slow down, the stop is here', 'tour.photo': 'Photo…',
  'tour.rerouted': 'Route recalculated', 'tour.againConfirm': 'Press again to restart the tour',
  'tour.intro': 'Welcome aboard! Today we see: {stops}. Smooth and steady, the tourists love it.', 'tour.outro': "That's it, we're back at the hotel. Thanks for the ride!",
  // ---- scoring events (the tour)
  'ev.l.brake': 'Hard braking', 'ev.l.emergency': 'Emergency braking', 'ev.l.turn': 'Fast turn', 'ev.l.danger': 'Dangerous turn', 'ev.l.touch': 'Wall touch', 'ev.l.hit': 'Hit!',
  'ev.l.hitHard': 'Hard hit!', 'ev.l.scrape': 'Scraping the wall', 'ev.l.nearPeople': 'Slower near people!', 'ev.l.fastDown': 'Too fast downhill!', 'ev.l.nitro': 'Oops! Nitro!',
  'ev.l.reset': 'Back onto the road', 'ev.l.leftEarly': 'Still taking photos!', 'ev.l.softStop': 'Gentle stop', 'ev.l.calm': 'Calm driving',
  'ev.s.brake': 'hard braking', 'ev.s.emergency': 'emergency braking', 'ev.s.turn': 'fast turn', 'ev.s.danger': 'dangerous turn', 'ev.s.touch': 'wall touch', 'ev.s.hit': 'hit',
  'ev.s.hitHard': 'hard hit', 'ev.s.scrape': 'scraping', 'ev.s.nearPeople': 'near people', 'ev.s.fastDown': 'fast downhill', 'ev.s.nitro': 'nitro', 'ev.s.reset': 'back onto the road', 'ev.s.leftEarly': 'left early',
  // ---- desktop dashboard / HUD
  'dash.nitro': 'NITRO', 'dash.nitroActive': 'NITRO!', 'dash.nitroWait': 'NITRO {s} s', 'dash.mood': 'Mood {v} %', 'dash.tips': 'Tips ≈ {v}', 'dash.na': 'n/a', 'dash.hz': 'Hz',
  'dash.tourDone': 'Tour complete!', 'dash.tipsV': 'Tips {v}', 'dash.timeLine': 'Time {a} / {b} — {c}', 'dash.onTime': 'on time', 'dash.almost': 'a bit longer', 'dash.late': 'late', 'dash.time': 'time',
  // ---- full-screen map
  'map.me': '◎ To me', 'map.title': 'Map · game paused', 'map.km': '1 km', 'map.m': '{n} m', 'map.north': '↑ N', 'map.editor': 'Level editor',
  // ---- touch controls
  'tc.brake': 'BRAKE', 'tc.gas': 'GAS', 'tc.hand': 'HAND', 'tc.nitro': 'NITRO', 'tc.nitroActive': 'NITRO!',
  // ---- phone interface: settings
  'set.control': 'Control mode', 'set.table': 'At the table', 'set.vrNext': 'Like VR (next stage)', 'set.tiltNext': 'Phone tilt (next stage)',
  'set.steer': 'Steering', 'set.steerButtons': 'buttons ◄ ►', 'set.steerSlider': 'slider', 'set.gas': 'Gas', 'set.gasAnalog': 'smooth (the higher the finger)', 'set.gasFull': 'full',
  'set.level': 'Crazy Tuk level', 'set.autoGas': 'Auto-gas (Crazy Tuk, ≈ 70 km/h)', 'set.sound': 'Sound', 'set.music': 'Music', 'set.fov': 'Horizontal field of view',
  'set.res': 'Picture resolution', 'set.resStd': 'standard (≈ 0.65 MP)', 'set.resHigh': 'high (≈ 0.85 MP)', 'set.resEco': 'economy (≈ 0.4 MP)',
  'set.vibration': 'Vibration (hits, nitro)', 'set.lookReturn': 'The view returns forward by itself', 'set.language': 'Language',
  // ---- phone interface: menu
  'ph.newTour': 'New tour', 'ph.freeRide': 'Free ride', 'ph.more': '↓ more settings', 'ph.install': 'Install as an app',
  'ph.fsBlocked': 'Full screen is not available here: {why}. Open the game in Chrome itself (⋮ → “Open in Chrome”) or add it to the home screen (⋮ → “Add to Home screen” / “Install app”).',
  'ph.pause': 'Pause', 'ph.resume': 'Resume ▶', 'ph.map': 'Full-screen map', 'ph.resetRoad': 'Back onto the road', 'ph.resetSureTour': 'Sure? In the tour −10 mood', 'ph.resetSure': 'Sure? Tap again',
  'ph.recenter': 'Re-centre the view', 'ph.restartTour': 'Restart the tour', 'ph.restartRun': 'Restart the run', 'ph.crazy': 'Crazy Tuk', 'ph.editor': 'Level editor', 'ph.sounds': 'Sounds',
  'ph.diag': 'Diagnostics and report', 'ph.fullscreen': 'Full screen ⛶', 'ph.camera': 'Camera', 'ph.cabTilt': 'Cab tilt', 'ph.minimap': 'Minimap', 'ph.yes': 'yes', 'ph.no': 'no',
  'ph.version': 'version {v}', 'ph.camCockpit': 'Camera: cockpit', 'ph.camChase': 'Camera: behind', 'ph.home': 'Main menu', 'ph.help': 'How to drive', 'ph.advanced': 'Advanced',
  'cam.cockpit': 'cockpit', 'cam.chase': 'behind', 'tilt.full': 'full', 'tilt.half': 'half', 'tilt.off': 'off',
  'set.tour': 'Real tour route', 'title.creditsTitle': 'Credits', 'title.creditsLink': 'credits',
  'set.vrSteer': 'VR steering', 'set.vrStick': 'stick', 'set.vrHands': 'hands on the bar', 'set.vrVignette': 'VR vignette (darker edges in turns and braking)', 'set.tilt': 'Cab tilt on slopes (K)', 'set.vrVibration': 'Engine vibration in the right grip (VR, hands on the bar)',
  'arc.start': 'Start', 'arc.gate': 'Gate {n}',
  'diag.title': 'Diagnostics', 'diag.bench': 'Measure', 'diag.copy': 'Copy the report', 'diag.refresh': 'Refresh', 'diag.again': 'Measure again', 'diag.close': 'Close', 'diag.start': 'Start measuring',
  'vig.weak': 'weak', 'vig.standard': 'standard', 'vig.strong': 'strong',
  // ---- loading and the title screen
  'st.textures': 'Drawing textures…', 'st.city': 'Loading the city…', 'st.terrain': 'Terrain…', 'st.photos': 'Facade photos…', 'st.models': '3D landmarks…', 'st.build': 'Building {n} houses…', 'st.shaders': 'Compiling shaders…',
  'st.ready': 'Ready', 'btn.play': 'Play', 'btn.playKb': 'Play (keyboard)',
  'title.sub': 'ALICANTE', 'title.tag': 'Tuk-tuk racing through the real streets of Alicante', 'title.crazy': 'CRAZY TUK', 'title.crazySub': 'race · drift · nitro · tips',
  'title.tour': 'Real tour', 'title.tourSub': 'calm ride with tourists', 'title.free': 'Free ride', 'title.freeSub': 'no timer, just the city',
  'title.settings': 'Settings ⚙', 'title.help': 'Help', 'title.rotate': '↻ Turn the phone sideways to play', 'title.level': 'Level', 'title.best': 'Best',
  'title.credits': '© OpenStreetMap contributors · © IGN (CNIG) · photos: Wikimedia Commons · 3D: Sketchfab · sounds: credits',
  'tip.1': '<b>Tip:</b> hit the gate dead-centre for +25 € and a combo.', 'tip.2': '<b>Tip:</b> the handbrake at speed makes the tuk-tuk slide. Long slides pay.',
  'tip.3': '<b>Tip:</b> nitro works from a standstill too, and it is the only way above 70 km/h.', 'tip.4': '<b>Tip:</b> passing a wall closely at speed without touching it pays.',
  'tip.5': '<b>Tip:</b> smashed cones and tables give tips. Walls take them away.', 'tip.6': '<b>Tip:</b> in the real tour the tourists love smooth driving.',
  'tip.7': '<b>Did you know?</b> These are the real streets of Alicante, from OpenStreetMap.', 'tip.8': '<b>Tip:</b> exact gates refill the nitro tank.',
  // ---- credits line
  'credit.base': '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · terrain © IGN (CNIG) · facade photos: <a href="assets/facades/CREDITS.md" target="_blank" rel="noopener">Wikimedia Commons</a> · 3D scans: <a href="assets/models/CREDITS.md" target="_blank" rel="noopener">Sketchfab</a> · sounds and music: <a href="assets/audio/CREDITS.md" target="_blank" rel="noopener">credits</a> (the Suno music is a test one, to be replaced)',
  'credit.sounds': 'Sounds: ', 'credit.photo': 'Facade photo:', 'credit.scan': '3D scan:', 'credit.dash': '© OpenStreetMap contributors · terrain © IGN (CNIG)',
};
