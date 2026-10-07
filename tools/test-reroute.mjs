// Does the tour recompute the route when the driver leaves it? The tuk-tuk is put on a street 25-55 m off the route
// (a wrong turn one block away); the route must be replaced within a few seconds and start at the tuk-tuk.
// Usage: node tools/test-reroute.mjs [tourId]
import { simulate } from './sim-tour.mjs';
import { polylineDistance } from '../src/game/route.js';

const tourId = process.argv[2] || 'castle';
let phase = 0, t0 = 0, v0 = 0, startedDriving = 0, car = null, oldRoute = null, result = null;
const trials = [];
try {
  simulate(tourId, 'careful', {
  onStep: (t, phys, tour) => {
    if (tour.state !== 'driving') { startedDriving = 0; return; }
    if (!startedDriving) startedDriving = t;
    if (phase === 0 && t - startedDriving > 25 && tour.route) {
      // a graph node 25-55 m from the route, ahead of the car in the route's direction is not needed: any will do
      const g = tour.graph, route = tour.route;
      let best = null;
      for (let i = 0; i < g.nodeCount; i++) {
        const d = polylineDistance(route, g.x[i], g.z[i]).d;
        if (d > 25 && d < 55 && Math.hypot(g.x[i] - phys.x, g.z[i] - phys.z) < 160) { best = i; break; }
      }
      if (best == null) return;
      oldRoute = route; v0 = tour.routeVersion; t0 = t; car = [g.x[best], g.z[best]];
      phys.teleport(car[0], car[1], phys.heading);
      phase = 1;
    } else if (phase === 1) {
      if (tour.routeVersion !== v0 || t - t0 > 8) {
        const first = tour.route && tour.route[0];
        result = { replaced: tour.routeVersion !== v0, after: +(t - t0).toFixed(1), startsAtCar: first ? +Math.hypot(first[0] - phys.x, first[1] - phys.z).toFixed(1) : null, differs: tour.route !== oldRoute };
        phase = 2; trials.push(result);
        throw new Error('done');
      }
    }
  },
  });
} catch (e) { if (e.message !== 'done') throw e; }
if (!result) { console.log('FAIL: the test never found a place to leave the route'); process.exit(1); }
console.log(JSON.stringify(result));
if (result.replaced && result.after <= 5 && result.startsAtCar < 15) console.log('OK: the route was recomputed ' + result.after + ' s after the wrong turn and starts at the tuk-tuk');
else { console.log('FAIL: the route was not recomputed in time (replaced=' + result.replaced + ', after ' + result.after + ' s)'); process.exit(1); }
