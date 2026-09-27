// VR player rig. The XR reference space ('local-floor') is parented to the tuk-tuk seat; recentring
// moves and turns the rig so that the real head lands on the driver's eye point, looking forward.
// So the seat adapts to the player's height and posture, not the other way round.
import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class XRRig {
  constructor(renderer, seat, eyeHeight) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'xr rig';
    seat.add(this.group);
    this.eye = new THREE.Vector3(0, eyeHeight, 0);
    this.pending = false;
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();

    // controllers: small dark bodies so the hands are visible in the cab
    const geo = new THREE.BoxGeometry(0.035, 0.03, 0.11);
    geo.translate(0, -0.01, 0.02);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b3038 });
    this.markers = {};
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const marker = new THREE.Mesh(geo, mat);
      grip.add(marker);
      grip.addEventListener('connected', (e) => { this.markers[e.data.handedness] = marker; });
      this.group.add(grip);
    }
  }

  // hide a hand's controller body (e.g. while it holds the handlebar and a glove is shown)
  showController(hand, visible) {
    const m = this.markers[hand];
    if (m) m.visible = visible;
  }

  recenter() { this.pending = true; }

  // Call every XR frame; applies a pending recentre once the head pose is known. Returns true then.
  update(xrFrame) {
    if (!this.pending || !xrFrame) return false;
    const pose = xrFrame.getViewerPose(this.renderer.xr.getReferenceSpace());
    if (!pose) return false;
    const p = pose.transform.position, o = pose.transform.orientation;
    this.v.set(0, 0, -1).applyQuaternion(this.q.set(o.x, o.y, o.z, o.w));
    const yaw = Math.atan2(-this.v.x, -this.v.z); // head yaw, three.js rotation.y convention
    this.group.rotation.set(0, -yaw, 0);
    this.v.set(p.x, p.y, p.z).applyAxisAngle(Y_AXIS, -yaw);
    this.group.position.copy(this.eye).sub(this.v);
    this.pending = false;
    return true;
  }
}
