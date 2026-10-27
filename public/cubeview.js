/* Where a view cube click takes the camera (sykehus). The kit's dirToView keeps the camera's yaw for a straight-down view, so a
   «Topp» click made while the camera was turned 30° gave a plan view with north 30° off screen-up, and the cube's own Topp face
   (and its label) lay sideways. A plan view is read north up: Topp goes to yaw 0. (The kit's choice is right for an app with no
   north; the fix is here, the one caller, not in the shared kit.) */
export const cubeView = (v, info) => info?.name === "top" ? { ...v, yaw: 0 } : v;
