import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { calculateWalkmeshBounds, cameraFixedToFloat, calculateCameraFOV } from '../fieldfile.ts';

const CAMERA_HEIGHT = 10000;
const FF7_VIEWPORT_WIDTH = 320;
const FF7_VIEWPORT_HEIGHT = 240;

/**
 * View offset state for pan/zoom without moving the camera.
 * This allows viewing different portions of the full background
 * while maintaining perfect walkmesh alignment.
 */
function createViewState(fullWidth, fullHeight, viewportAspect) {
    // Calculate zoom level to fit the entire background in the viewport
    // At zoom Z, we see (240/Z) pixels vertically and (240/Z)*aspect pixels horizontally
    const zoomToFitHeight = FF7_VIEWPORT_HEIGHT / fullHeight;
    const zoomToFitWidth = (FF7_VIEWPORT_HEIGHT * viewportAspect) / fullWidth;
    const fitZoom = Math.min(zoomToFitHeight, zoomToFitWidth);

    return {
        fullWidth,
        fullHeight,
        // View center position (in background pixels)
        centerX: fullWidth / 2,
        centerY: fullHeight / 2,
        // Zoom level: 1.0 = shows 240px vertical extent (game viewport height)
        zoom: fitZoom,
        targetZoom: fitZoom,
        minZoom: 0.1,   // Allow zooming out further
        maxZoom: 4.0,
    };
}

/**
 * Apply view state to camera using setViewOffset.
 * The view dimensions adapt to the viewport aspect ratio while maintaining
 * the correct vertical scale based on zoom level.
 */
function applyViewState(camera, viewState, viewportAspect) {
    // Base vertical extent is the FF7 viewport height, scaled by zoom
    const currentViewHeight = FF7_VIEWPORT_HEIGHT / viewState.zoom;
    // Width adapts to viewport aspect ratio
    const currentViewWidth = currentViewHeight * viewportAspect;

    // Calculate top-left from center
    let viewX = viewState.centerX - currentViewWidth / 2;
    let viewY = viewState.centerY - currentViewHeight / 2;

    // Handle positioning based on whether view is larger or smaller than background
    if (currentViewWidth >= viewState.fullWidth) {
        // View is wider than background: center the background horizontally
        viewX = (viewState.fullWidth - currentViewWidth) / 2;
    } else {
        // View is narrower: clamp to stay within bounds
        const maxX = viewState.fullWidth - currentViewWidth;
        viewX = Math.max(0, Math.min(viewX, maxX));
    }

    if (currentViewHeight >= viewState.fullHeight) {
        // View is taller than background: center the background vertically
        viewY = (viewState.fullHeight - currentViewHeight) / 2;
    } else {
        // View is shorter: clamp to stay within bounds
        const maxY = viewState.fullHeight - currentViewHeight;
        viewY = Math.max(0, Math.min(viewY, maxY));
    }

    // Update center position based on clamping/centering
    viewState.centerX = viewX + currentViewWidth / 2;
    viewState.centerY = viewY + currentViewHeight / 2;

    camera.setViewOffset(
        viewState.fullWidth,
        viewState.fullHeight,
        viewX,
        viewY,
        currentViewWidth,
        currentViewHeight
    );
    camera.updateProjectionMatrix();
}

/**
 * Convert FF7 camera data to Three.js camera configuration
 * Following the documentation's view matrix construction:
 * 1. Convert fixed-point to float (axis vectors only - they're normalized)
 * 2. Negate Y axis and Y position
 * 3. Compute eye position by transforming camera position through rotation matrix
 * 4. Use lookAt with eye, center, and up
 *
 * NOTE: Camera position is NOT divided by 4096 because walkmesh vertices aren't either.
 * This keeps both in the same coordinate space.
 *
 * @param {Object} cameraData - FF7 camera data from fieldfile
 * @returns {Object} Three.js camera configuration
 */
function ff7CameraToThreeJS(cameraData) {
    // Camera position - NOT divided by 4096 to match walkmesh vertex scale
    // Only negate Y per docs
    const camPos = {
        x: cameraData.position.x,
        y: -cameraData.position.y,  // Negate Y per docs
        z: cameraData.position.z,
    };

    // Axis vectors ARE divided by 4096 because they're normalized unit vectors
    // stored as fixed-point where 4096 = 1.0
    // axis[0] = X-axis (right), axis[1] = Y-axis (up), axis[2] = Z-axis (forward)
    const axisX = {
        x: cameraFixedToFloat(cameraData.axis[0].x),
        y: cameraFixedToFloat(cameraData.axis[0].y),
        z: cameraFixedToFloat(cameraData.axis[0].z),
    };
    // Negate Y axis per docs
    const axisY = {
        x: -cameraFixedToFloat(cameraData.axis[1].x),
        y: -cameraFixedToFloat(cameraData.axis[1].y),
        z: -cameraFixedToFloat(cameraData.axis[1].z),
    };
    const axisZ = {
        x: cameraFixedToFloat(cameraData.axis[2].x),
        y: cameraFixedToFloat(cameraData.axis[2].y),
        z: cameraFixedToFloat(cameraData.axis[2].z),
    };

    // Compute eye position by transforming camera position through rotation matrix
    // tx = -(camPosX * axisXx + camPosY * axisYx + camPosZ * axisZx)
    const tx = -(camPos.x * axisX.x + camPos.y * axisY.x + camPos.z * axisZ.x);
    const ty = -(camPos.x * axisX.y + camPos.y * axisY.y + camPos.z * axisZ.y);
    const tz = -(camPos.x * axisX.z + camPos.y * axisY.z + camPos.z * axisZ.z);

    // Apply coordinate conversion: FF7 (x,y,z) -> Three.js (x,z,-y)
    // This matches how walkmesh vertices are transformed
    const eye = new THREE.Vector3(tx, tz, -ty);

    // Forward direction in Three.js coords
    const forward = new THREE.Vector3(axisZ.x, axisZ.z, -axisZ.y).normalize();

    // Up direction in Three.js coords
    const up = new THREE.Vector3(axisY.x, axisY.z, -axisY.y).normalize();

    // Center is eye + forward direction (scaled for lookAt)
    const center = eye.clone().add(forward.clone().multiplyScalar(1000));

    return {
        eye,
        center,
        up,
        fov: calculateCameraFOV(cameraData.zoom),
        forward,
    };
}

/**
 * Create a background plane positioned behind the walkmesh
 *
 * The plane is sized to match the camera's full view (accounting for its aspect ratio).
 * This works with the view offset approach where:
 * - Camera aspect = background aspect (sees the whole background)
 * - setViewOffset crops to show a 320x240 window
 * - The plane fills the camera's full view exactly
 *
 * @param {HTMLCanvasElement} canvas - The rendered background canvas
 * @param {Object} backgroundDimensions - { width, height, minX, minY } of the background
 * @param {THREE.Vector3} cameraPosition - Camera eye position
 * @param {THREE.Vector3} cameraForward - Camera forward direction (normalized)
 * @param {THREE.Vector3} cameraUp - Camera up direction (normalized)
 * @param {number} fov - Vertical field of view in degrees (base FF7 FOV, not adjusted)
 * @param {number} distance - Distance from camera to place the plane
 * @returns {THREE.Mesh} The background plane mesh
 */
function createBackgroundPlane(canvas, backgroundDimensions, cameraPosition, cameraForward, cameraUp, fov, distance) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.NearestFilter;

    // Calculate visible dimensions at this distance based on FOV.
    // The camera's FOV is the vertical field of view for the game's 320x240 viewport.
    // But the camera aspect is set to background aspect, so it sees the full background.
    //
    // For vertical: visibleHeight at 320x240 would be based on FOV
    // But we've scaled the FOV to account for background height vs 240px
    // So the visible height matches the background height in world units
    const fovRad = fov * Math.PI / 180;
    const visibleHeight = 2 * distance * Math.tan(fovRad / 2);

    // The background aspect determines the width
    const bgAspect = backgroundDimensions.width / backgroundDimensions.height;
    const planeHeight = visibleHeight;
    const planeWidth = planeHeight * bgAspect;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const plane = new THREE.Mesh(geometry, material);

    // Calculate center offset for backgrounds not centered at (0,0)
    // With view offset approach, we still need to align the plane so that
    // the game's (0,0) screen coordinate appears at the right position
    const centerX = backgroundDimensions.minX + backgroundDimensions.width / 2;
    const centerY = backgroundDimensions.minY + backgroundDimensions.height / 2;

    const pixelToWorldX = planeWidth / backgroundDimensions.width;
    const pixelToWorldY = planeHeight / backgroundDimensions.height;

    const worldOffsetX = centerX * pixelToWorldX;
    const worldOffsetY = -centerY * pixelToWorldY;

    const cameraRight = new THREE.Vector3().crossVectors(cameraForward, cameraUp).normalize();

    const planePosition = cameraPosition.clone()
        .add(cameraForward.clone().multiplyScalar(distance))
        .add(cameraRight.clone().multiplyScalar(worldOffsetX))
        .add(cameraUp.clone().multiplyScalar(worldOffsetY));
    plane.position.copy(planePosition);

    const lookAtTarget = planePosition.clone().sub(cameraForward);
    plane.up.copy(cameraUp);
    plane.lookAt(lookAtTarget);

    return plane;
}

// Create a canvas texture for a triangle ID label
function createTextSprite(text) {
    const canvas = document.createElement('canvas');
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Draw text
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#b0d0ff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(text, size / 2, size / 2);
    ctx.fillText(text, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(40, 40, 1);

    return sprite;
}

export function WalkmeshPreview({
    walkmesh,
    gateways,
    wireframe,
    showGateways,
    showTriangleIds,
    showWalkmeshOverlay = true,
    rotation,
    onResetRequest,
    cameraMode = 'orthographic',
    cameraData = null,
    backgroundCanvasRef = null,
    backgroundDimensions = null,
    backgroundRenderKey = 0,
}) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const controlsRef = useRef(null);
    const rendererRef = useRef(null);
    const meshGroupRef = useRef(null);
    const resetFnRef = useRef(null);
    const triangleSpritesRef = useRef([]);
    const viewStateRef = useRef(null);  // For view offset pan/zoom

    // Calculate dimensions
    const dimensions = useMemo(() => {
        if (!walkmesh || walkmesh.triangles.length === 0) {
            return { width: 0, height: 0, center: { x: 0, y: 0, z: 0 } };
        }

        const b = calculateWalkmeshBounds(walkmesh);
        const width = b.maxX - b.minX;
        const height = b.maxY - b.minY;

        return {
            width,
            height,
            center: {
                x: b.centerX,
                y: b.centerZ,
                z: -b.centerY,
            },
        };
    }, [walkmesh]);

    // Build geometries
    const geometries = useMemo(() => {
        if (!walkmesh || walkmesh.triangles.length === 0) {
            return null;
        }

        // Main mesh geometry
        const positions = [];
        const indices = [];
        const colors = [];
        let vertexIndex = 0;

        for (const triangle of walkmesh.triangles) {
            for (const vertex of triangle.vertices) {
                positions.push(vertex.x, vertex.z, -vertex.y);
                // #1E293B
                colors.push(0.118, 0.161, 0.231);
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            vertexIndex += 3;
        }

        const meshGeo = new THREE.BufferGeometry();
        meshGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        meshGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        meshGeo.setIndex(indices);
        meshGeo.computeVertexNormals();

        // Edge geometry (all edges)
        const edgePositions = [];
        for (const triangle of walkmesh.triangles) {
            const v = triangle.vertices;
            edgePositions.push(v[0].x, v[0].z, -v[0].y);
            edgePositions.push(v[1].x, v[1].z, -v[1].y);
            edgePositions.push(v[1].x, v[1].z, -v[1].y);
            edgePositions.push(v[2].x, v[2].z, -v[2].y);
            edgePositions.push(v[2].x, v[2].z, -v[2].y);
            edgePositions.push(v[0].x, v[0].z, -v[0].y);
        }

        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));

        // Blocked edge geometry (access === 0xFFFF)
        const blockedPositions = [];
        for (const triangle of walkmesh.triangles) {
            const v = triangle.vertices;
            const access = triangle.access;

            if (access[0] === 0xFFFF) {
                blockedPositions.push(v[0].x, v[0].z, -v[0].y);
                blockedPositions.push(v[1].x, v[1].z, -v[1].y);
            }
            if (access[1] === 0xFFFF) {
                blockedPositions.push(v[1].x, v[1].z, -v[1].y);
                blockedPositions.push(v[2].x, v[2].z, -v[2].y);
            }
            if (access[2] === 0xFFFF) {
                blockedPositions.push(v[2].x, v[2].z, -v[2].y);
                blockedPositions.push(v[0].x, v[0].z, -v[0].y);
            }
        }

        const blockedGeo = new THREE.BufferGeometry();
        blockedGeo.setAttribute('position', new THREE.Float32BufferAttribute(blockedPositions, 3));

        return { meshGeo, edgeGeo, blockedGeo };
    }, [walkmesh]);

    // Build gateway geometries
    const gatewayGeometries = useMemo(() => {
        if (!gateways || gateways.length === 0) {
            return null;
        }

        const QUAD_SIZE = 5;
        const quadPositions = [];
        const quadIndices = [];
        let vertexIndex = 0;

        for (const gateway of gateways) {
            for (const vertex of [gateway.vertex1, gateway.vertex2]) {
                const x = vertex.x;
                const y = vertex.z;
                const z = -vertex.y;

                quadPositions.push(x - QUAD_SIZE, y + 5, z - QUAD_SIZE);
                quadPositions.push(x + QUAD_SIZE, y + 5, z - QUAD_SIZE);
                quadPositions.push(x + QUAD_SIZE, y + 5, z + QUAD_SIZE);
                quadPositions.push(x - QUAD_SIZE, y + 5, z + QUAD_SIZE);

                quadIndices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
                quadIndices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
                vertexIndex += 4;
            }
        }

        const quadGeo = new THREE.BufferGeometry();
        quadGeo.setAttribute('position', new THREE.Float32BufferAttribute(quadPositions, 3));
        quadGeo.setIndex(quadIndices);
        quadGeo.computeVertexNormals();

        // Gateway lines connecting the two vertices
        const linePositions = [];
        for (const gateway of gateways) {
            const v1 = gateway.vertex1;
            const v2 = gateway.vertex2;
            linePositions.push(v1.x, v1.z + 5, -v1.y);
            linePositions.push(v2.x, v2.z + 5, -v2.y);
        }

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

        return { quadGeo, lineGeo };
    }, [gateways]);

    // Initialize Three.js scene
    useEffect(() => {
        if (!containerRef.current || !geometries) return;

        const container = containerRef.current;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111111);
        sceneRef.current = scene;

        let camera;
        const margin = 200;
        const mapAspect = dimensions.width / dimensions.height || 1;
        const isPerspective = cameraMode === 'perspective' && cameraData;

        if (isPerspective) {
            // Perspective camera using FF7 camera data
            const ff7Cam = ff7CameraToThreeJS(cameraData);

            // Calculate FOV: scale by background height vs game viewport height
            // This ensures the background fills the vertical extent correctly
            const bgScaleY = backgroundDimensions ? backgroundDimensions.height / FF7_VIEWPORT_HEIGHT : 1;
            const adjustedFov = 2 * Math.atan(Math.tan(ff7Cam.fov * Math.PI / 360) * bgScaleY) * (180 / Math.PI);

            // Use background aspect ratio for camera - this allows the camera to "see"
            // the entire background. We'll use setViewOffset to show a 320x240 window.
            const bgWidth = backgroundDimensions ? backgroundDimensions.width : FF7_VIEWPORT_WIDTH;
            const bgHeight = backgroundDimensions ? backgroundDimensions.height : FF7_VIEWPORT_HEIGHT;
            const bgAspect = bgWidth / bgHeight;

            camera = new THREE.PerspectiveCamera(
                adjustedFov,
                bgAspect,  // Use background aspect to see full background
                1,
                100000
            );

            // Initialize view state for pan/zoom via view offset
            // Use container aspect for view offset dimensions and fit-to-screen calculation
            const viewportAspect = containerWidth / containerHeight;
            viewStateRef.current = createViewState(bgWidth, bgHeight, viewportAspect);

            // Apply initial view offset (centered, fit to screen)
            applyViewState(camera, viewStateRef.current, viewportAspect);

            // Use lookAt to set camera position and orientation
            camera.position.copy(ff7Cam.eye);
            camera.up.copy(ff7Cam.up);
            camera.lookAt(ff7Cam.center);

            // Add background plane if canvas is available
            const bgCanvas = backgroundCanvasRef?.current;
            if (bgCanvas && backgroundDimensions) {
                const walkmeshDepth = Math.max(dimensions.width, dimensions.height);
                const bgDistance = walkmeshDepth * 2;

                const bgPlane = createBackgroundPlane(
                    bgCanvas,
                    backgroundDimensions,
                    ff7Cam.eye,
                    ff7Cam.forward,
                    ff7Cam.up,
                    adjustedFov,
                    bgDistance
                );
                bgPlane.renderOrder = -1;
                scene.add(bgPlane);
            }
        } else {
            // Orthographic camera (top-down view)
            const containerAspect = containerWidth / containerHeight;
            let halfHeight = Math.max(dimensions.height, 500) / 2 + margin;
            let halfWidth = Math.max(dimensions.width, 500) / 2 + margin;

            if (containerAspect > mapAspect) {
                halfWidth = halfHeight * containerAspect;
            } else {
                halfHeight = halfWidth / containerAspect;
            }

            camera = new THREE.OrthographicCamera(
                -halfWidth, halfWidth,
                halfHeight, -halfHeight,
                -100000, 100000
            );
            camera.position.set(dimensions.center.x, CAMERA_HEIGHT, dimensions.center.z);
            camera.lookAt(dimensions.center.x, 0, dimensions.center.z);
        }
        cameraRef.current = camera;

        // Renderer - always use full container size
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerWidth, containerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Controls - orbit style for orthographic, limited for perspective
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true;

        if (isPerspective) {
            // For perspective mode: disable zoom/pan (we use custom view offset handlers)
            // Rotation uses right mouse button
            controls.enableZoom = false;
            controls.enablePan = false;
            controls.enableRotate = true;
            controls.mouseButtons = {
                LEFT: null,  // We handle left-click panning ourselves
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE,
            };
            const ff7Cam = ff7CameraToThreeJS(cameraData);
            controls.target.copy(ff7Cam.center);
        } else {
            controls.target.set(dimensions.center.x, 0, dimensions.center.z);
        }
        controls.update();
        controlsRef.current = controls;

        // Custom zoom handler for perspective mode (via view offset)
        // Uses smooth interpolation - sets targetZoom, animation loop interpolates zoom
        const handleWheel = (e) => {
            if (!isPerspective || !viewStateRef.current) return;

            e.preventDefault();
            const vs = viewStateRef.current;

            // Reduced sensitivity: smaller factor for smoother zooming
            const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
            vs.targetZoom = Math.max(vs.minZoom, Math.min(vs.maxZoom, vs.targetZoom * zoomFactor));
        };

        // Custom pan handler for perspective mode (via view offset)
        // Left-click drag to pan, right-click drag to orbit (handled by OrbitControls)
        let isPanning = false;
        let panStartX = 0;
        let panStartY = 0;
        let panStartCenterX = 0;
        let panStartCenterY = 0;

        const handleMouseDown = (e) => {
            if (!isPerspective || !viewStateRef.current) return;
            if (e.button !== 0) return;  // Only handle left-click for panning

            // Left-click: pan
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartCenterX = viewStateRef.current.centerX;
            panStartCenterY = viewStateRef.current.centerY;
            e.preventDefault();
        };

        const handleMouseMove = (e) => {
            if (!isPanning || !viewStateRef.current) return;

            const vs = viewStateRef.current;
            const rect = renderer.domElement.getBoundingClientRect();
            const viewportAspect = rect.width / rect.height;

            // Calculate how much we've moved in screen pixels
            const deltaX = e.clientX - panStartX;
            const deltaY = e.clientY - panStartY;

            // Convert to background pixels (accounting for current zoom and viewport aspect)
            const currentViewHeight = FF7_VIEWPORT_HEIGHT / vs.zoom;
            const currentViewWidth = currentViewHeight * viewportAspect;
            const bgDeltaX = -(deltaX / rect.width) * currentViewWidth;
            const bgDeltaY = -(deltaY / rect.height) * currentViewHeight;

            vs.centerX = panStartCenterX + bgDeltaX;
            vs.centerY = panStartCenterY + bgDeltaY;

            applyViewState(camera, vs, viewportAspect);
        };

        const handleMouseUp = () => {
            isPanning = false;
        };

        // Prevent context menu and default drag behavior
        const handleContextMenu = (e) => e.preventDefault();

        // Add event listeners for custom pan/zoom
        if (isPerspective) {
            renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
            // Use capture phase so our handler fires before OrbitControls
            renderer.domElement.addEventListener('mousedown', handleMouseDown, { capture: true });
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            renderer.domElement.addEventListener('contextmenu', handleContextMenu);
        }

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1000, 2000, 1000);
        scene.add(directionalLight);

        // Create mesh group for rotation
        const meshGroup = new THREE.Group();
        meshGroup.position.set(dimensions.center.x, 0, dimensions.center.z);
        scene.add(meshGroup);
        meshGroupRef.current = meshGroup;

        // Inner group offset to rotate around center
        const innerGroup = new THREE.Group();
        innerGroup.position.set(-dimensions.center.x, 0, -dimensions.center.z);
        meshGroup.add(innerGroup);

        // Only add walkmesh elements if showWalkmeshOverlay is true
        if (showWalkmeshOverlay) {
            // Main mesh - less transparent in perspective mode to enhance visibility on lighter backgrounds
            const meshOpacity = isPerspective
                ? (wireframe ? 0.5 : 0.4)
                : (wireframe ? 0.3 : 0.8);
            const meshMaterial = new THREE.MeshStandardMaterial({
                vertexColors: true,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: meshOpacity,
                polygonOffset: wireframe,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1,
            });
            const mesh = new THREE.Mesh(geometries.meshGeo, meshMaterial);
            innerGroup.add(mesh);

            // Edge lines (wireframe) - brighter in perspective mode
            if (wireframe) {
                const edgeMaterial = new THREE.LineBasicMaterial({
                    color: isPerspective ? 0xFFFFFF : 0x3E4C5E,
                    opacity: isPerspective ? 1.0 : 0.4,
                    transparent: true,
                });
                const edgeLines = new THREE.LineSegments(geometries.edgeGeo, edgeMaterial);
                innerGroup.add(edgeLines);

                // Blocked edges - brighter in perspective mode
                const blockedMaterial = new THREE.LineBasicMaterial({
                    color: isPerspective ? 0xFFBB66 : 0xeeeeff,
                    opacity: isPerspective ? 1.0 : 0.5,
                    transparent: true,
                });
                const blockedLines = new THREE.LineSegments(geometries.blockedGeo, blockedMaterial);
                innerGroup.add(blockedLines);
            }

            // Gateways
            if (showGateways && gatewayGeometries) {
                const gatewayMaterial = new THREE.MeshStandardMaterial({
                    color: 0xff3333,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.8,
                });
                const gatewayMesh = new THREE.Mesh(gatewayGeometries.quadGeo, gatewayMaterial);
                innerGroup.add(gatewayMesh);

                const gatewayLineMaterial = new THREE.LineBasicMaterial({
                    color: 0xff3333,
                    opacity: 0.9,
                    transparent: true,
                });
                const gatewayLines = new THREE.LineSegments(gatewayGeometries.lineGeo, gatewayLineMaterial);
                innerGroup.add(gatewayLines);
            }

            // Triangle IDs
            triangleSpritesRef.current = [];
            if (showTriangleIds && walkmesh) {
                for (let i = 0; i < walkmesh.triangles.length; i++) {
                    const triangle = walkmesh.triangles[i];
                    const v = triangle.vertices;

                    // Calculate centroid
                    const cx = (v[0].x + v[1].x + v[2].x) / 3;
                    const cy = (v[0].z + v[1].z + v[2].z) / 3;
                    const cz = -(v[0].y + v[1].y + v[2].y) / 3;

                    const sprite = createTextSprite(String(i));
                    sprite.position.set(cx, cy + 2, cz);
                    innerGroup.add(sprite);
                    triangleSpritesRef.current.push(sprite);
                }
            }
        } else {
            // Clear triangle sprites when not showing walkmesh
            triangleSpritesRef.current = [];
        }

        // Apply rotation
        meshGroup.rotation.y = rotation;

        // Reset function
        const setupCamera = () => {
            if (isPerspective && cameraData) {
                // Reset perspective camera to FF7 camera position
                const ff7Cam = ff7CameraToThreeJS(cameraData);

                // Recalculate adjusted FOV based on height
                const bgScaleY = backgroundDimensions ? backgroundDimensions.height / FF7_VIEWPORT_HEIGHT : 1;
                const adjustedFov = 2 * Math.atan(Math.tan(ff7Cam.fov * Math.PI / 360) * bgScaleY) * (180 / Math.PI);

                // Use background aspect (camera sees full background)
                const resetBgWidth = backgroundDimensions ? backgroundDimensions.width : FF7_VIEWPORT_WIDTH;
                const resetBgHeight = backgroundDimensions ? backgroundDimensions.height : FF7_VIEWPORT_HEIGHT;
                const resetBgAspect = resetBgWidth / resetBgHeight;

                camera.fov = adjustedFov;
                camera.aspect = resetBgAspect;

                // Reset view state to centered position and fit-to-screen zoom
                const resetViewportAspect = container.clientWidth / container.clientHeight;
                const newViewState = createViewState(resetBgWidth, resetBgHeight, resetViewportAspect);
                // Ensure targetZoom matches zoom so no interpolation happens
                newViewState.targetZoom = newViewState.zoom;
                viewStateRef.current = newViewState;
                applyViewState(camera, viewStateRef.current, resetViewportAspect);

                renderer.setSize(container.clientWidth, container.clientHeight);
                camera.position.copy(ff7Cam.eye);
                camera.up.copy(ff7Cam.up);
                camera.lookAt(ff7Cam.center);

                // Reset orbit controls target
                controls.target.copy(ff7Cam.center);
                controls.update();
            } else {
                // Reset orthographic camera
                const containerAspect = container.clientWidth / container.clientHeight;
                const mapAspect = dimensions.width / dimensions.height || 1;

                let hh = Math.max(dimensions.height, 500) / 2 + margin;
                let hw = Math.max(dimensions.width, 500) / 2 + margin;

                if (containerAspect > mapAspect) {
                    hw = hh * containerAspect;
                } else {
                    hh = hw / containerAspect;
                }

                camera.left = -hw;
                camera.right = hw;
                camera.top = hh;
                camera.bottom = -hh;
                camera.position.set(dimensions.center.x, CAMERA_HEIGHT, dimensions.center.z);
                camera.zoom = 1;
                camera.updateProjectionMatrix();
                controls.target.set(dimensions.center.x, 0, dimensions.center.z);
                controls.update();
            }
        };

        resetFnRef.current = setupCamera;

        // Handle resize
        const handleResize = () => {
            const containerW = container.clientWidth;
            const containerH = container.clientHeight;

            if (isPerspective) {
                // In perspective mode with view offset, recalculate view offset
                // with new viewport aspect ratio to prevent stretching
                renderer.setSize(containerW, containerH);
                if (viewStateRef.current) {
                    const newViewportAspect = containerW / containerH;
                    applyViewState(camera, viewStateRef.current, newViewportAspect);
                }
            } else {
                // Orthographic camera resize
                const aspect = containerW / containerH;
                const mapAsp = dimensions.width / dimensions.height || 1;

                let hh = Math.max(dimensions.height, 500) / 2 + margin;
                let hw = Math.max(dimensions.width, 500) / 2 + margin;

                if (aspect > mapAsp) {
                    hw = hh * aspect;
                } else {
                    hh = hw / aspect;
                }

                const zoom = camera.zoom;
                camera.left = -hw;
                camera.right = hw;
                camera.top = hh;
                camera.bottom = -hh;
                camera.zoom = zoom;
                camera.updateProjectionMatrix();
                renderer.setSize(containerW, containerH);
            }
        };

        window.addEventListener('resize', handleResize);

        // Limit zoom (only for orthographic)
        const handleCameraChange = () => {
            if (!isPerspective && camera.zoom < 0.1) {
                camera.zoom = 0.1;
                camera.updateProjectionMatrix();
            }
        };
        controls.addEventListener('change', handleCameraChange);

        // Animation loop
        let animationId;
        const BASE_SPRITE_SCALE = 75;
        const MIN_SPRITE_SCALE = 15;
        const MAX_SPRITE_SCALE = 90;
        const ZOOM_LERP_FACTOR = 0.15;  // Smooth zoom interpolation speed
        const animate = () => {
            animationId = requestAnimationFrame(animate);
            controls.update();

            // Smooth zoom interpolation for perspective mode
            if (isPerspective && viewStateRef.current) {
                const vs = viewStateRef.current;
                const zoomDiff = vs.targetZoom - vs.zoom;
                if (Math.abs(zoomDiff) > 0.001) {
                    vs.zoom += zoomDiff * ZOOM_LERP_FACTOR;
                    const rect = renderer.domElement.getBoundingClientRect();
                    const viewportAspect = rect.width / rect.height;
                    applyViewState(camera, vs, viewportAspect);
                }
            }

            // Scale triangle ID sprites inversely with zoom, clamped to min/max bounds
            // For perspective with view offset, use viewState.zoom; otherwise use camera.zoom
            const effectiveZoom = (isPerspective && viewStateRef.current)
                ? viewStateRef.current.zoom
                : camera.zoom;
            const rawScale = BASE_SPRITE_SCALE / effectiveZoom;
            const spriteScale = Math.max(MIN_SPRITE_SCALE, Math.min(MAX_SPRITE_SCALE, rawScale));
            for (const sprite of triangleSpritesRef.current) {
                sprite.scale.set(spriteScale, spriteScale, 1);
            }

            renderer.render(scene, camera);
        };
        animate();

        // Cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            controls.removeEventListener('change', handleCameraChange);
            cancelAnimationFrame(animationId);
            controls.dispose();
            renderer.dispose();

            // Remove custom pan/zoom event listeners for perspective mode
            if (isPerspective) {
                renderer.domElement.removeEventListener('wheel', handleWheel);
                renderer.domElement.removeEventListener('mousedown', handleMouseDown, { capture: true });
                renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            }

            // Dispose geometries and materials
            scene.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });

            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [geometries, gatewayGeometries, dimensions, wireframe, showGateways, showTriangleIds, showWalkmeshOverlay, walkmesh, rotation, cameraMode, cameraData, backgroundCanvasRef, backgroundDimensions, backgroundRenderKey]);

    // Handle external reset request
    useEffect(() => {
        if (onResetRequest && resetFnRef.current) {
            onResetRequest(resetFnRef.current);
        }
    }, [onResetRequest]);

    if (!walkmesh || walkmesh.triangles.length === 0) {
        return (
            <div className="walkmesh-empty">
                <div className="walkmesh-empty-text">No walkmesh data</div>
            </div>
        );
    }

    return (
        <div className="walkmesh-container" ref={containerRef} />
    );
}
