import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';

// Culling flags from FF7 P file format (PHundret structure)
const V_CULLFACE = 0x2000;
const V_NOCULL = 0x4000;

/**
 * Determine material side based on hundret culling flags
 * @param {Object} hundret - The hundret structure from P file
 * @param {boolean} cullingEnabled - Whether to apply culling or use DoubleSide
 * @param {boolean} invertCulling - Whether to invert front/back side selection
 * @returns {number} THREE.Side value
 */
function getMaterialSide(hundret, cullingEnabled, invertCulling = false) {
    // If culling is disabled, render both sides
    if (!cullingEnabled) {
        return THREE.DoubleSide;
    }

    const field_C = hundret?.field_C || 0;
    const field_8 = hundret?.field_8 || 0;

    let side;

    // Check V_NOCULL first (higher priority)
    if (field_C & V_NOCULL) {
        if (field_8 & V_NOCULL) {
            side = THREE.DoubleSide; // No culling - render both sides
        } else {
            side = THREE.BackSide; // Cull front faces
        }
    }
    // Check V_CULLFACE
    else if (field_C & V_CULLFACE) {
        if (field_8 & V_CULLFACE) {
            side = THREE.BackSide; // Cull front faces
        } else {
            side = THREE.FrontSide; // Cull back faces (standard)
        }
    }
    // Default: cull back faces (standard backface culling)
    else {
        side = THREE.FrontSide;
    }

    // Invert if requested (swap FrontSide <-> BackSide)
    if (invertCulling && side !== THREE.DoubleSide) {
        side = side === THREE.FrontSide ? THREE.BackSide : THREE.FrontSide;
    }

    return side;
}

/**
 * Create a Three.js mesh group from a P file
 *
 * @param {Object} pfile - Parsed P file
 * @param {Object} options - Rendering options
 * @param {THREE.Texture[]} [options.textures=[]] - Textures for textured groups
 * @param {boolean} [options.vertexColors=true] - Use vertex colors
 * @param {boolean} [options.smoothShading=true] - Smooth vs flat shading
 * @param {boolean} [options.cullingEnabled=true] - Respect hundret flags vs DoubleSide
 * @param {boolean} [options.invertCulling=false] - Invert front/back face culling
 * @param {boolean} [options.polygonOffset=true] - Use polygon offset for z-fighting
 * @param {number} [options.meshIndex=0] - Index for polygon offset ordering
 * @returns {THREE.Group} Group containing meshes for each group in the P file
 */
export function createMeshFromPFile(pfile, options = {}) {
    const {
        textures = [],
        vertexColors: useVertexColors = true,
        smoothShading = true,
        cullingEnabled = true,
        invertCulling = false,
        polygonOffset = true,
        meshIndex = 0,
    } = options;

    const { vertices, polygons, vertexColors, texCoords, groups, normals, hundrets } = pfile.model;
    const meshGroup = new THREE.Group();
    const hasFileNormals = normals && normals.length > 0;

    // Process each group separately for per-group materials and culling
    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
        const group = groups[groupIdx];
        const hundret = hundrets?.[groupIdx];
        const isTextured = group.texFlag === 1 &&
                          textures.length > 0 &&
                          group.texID < textures.length &&
                          textures[group.texID] != null;

        // Skip textured groups if no textures are supplied
        if (group.texFlag === 1 && !isTextured) {
            continue;
        }

        const positions = [];
        const normalArray = [];
        const uvs = [];
        const colors = [];

        // Process polygons for this group
        for (let i = 0; i < group.numPoly; i++) {
            const polyIdx = group.offsetPoly + i;
            if (polyIdx >= polygons.length) continue;

            const poly = polygons[polyIdx];
            const [i0, i1, i2] = poly.vertices;

            // Add group offset to get actual vertex indices
            const vi0 = i0 + group.offsetVert;
            const vi1 = i1 + group.offsetVert;
            const vi2 = i2 + group.offsetVert;

            if (vi0 >= vertices.length || vi1 >= vertices.length || vi2 >= vertices.length) continue;

            // Positions (FF7 uses Y-up coordinate system, same as Three.js)
            const v0 = vertices[vi0], v1 = vertices[vi1], v2 = vertices[vi2];
            positions.push(v0.x, v0.y, v0.z);
            positions.push(v1.x, v1.y, v1.z);
            positions.push(v2.x, v2.y, v2.z);

            // Normals from file (if available)
            if (hasFileNormals && poly.normals) {
                const [n0, n1, n2] = poly.normals;
                const norm0 = normals[n0] || { x: 0, y: 1, z: 0 };
                const norm1 = normals[n1] || { x: 0, y: 1, z: 0 };
                const norm2 = normals[n2] || { x: 0, y: 1, z: 0 };
                normalArray.push(norm0.x, norm0.y, norm0.z);
                normalArray.push(norm1.x, norm1.y, norm1.z);
                normalArray.push(norm2.x, norm2.y, norm2.z);
            }

            // Texture coordinates (if textured)
            if (isTextured && texCoords.length > 0) {
                const uv0 = texCoords[group.offsetTex + i0] || { u: 0, v: 0 };
                const uv1 = texCoords[group.offsetTex + i1] || { u: 0, v: 0 };
                const uv2 = texCoords[group.offsetTex + i2] || { u: 0, v: 0 };
                uvs.push(uv0.u, uv0.v, uv1.u, uv1.v, uv2.u, uv2.v);
            }

            // Vertex colors
            if (useVertexColors && vertexColors.length > 0) {
                const c0 = vertexColors[vi0] || { r: 128, g: 128, b: 128 };
                const c1 = vertexColors[vi1] || { r: 128, g: 128, b: 128 };
                const c2 = vertexColors[vi2] || { r: 128, g: 128, b: 128 };
                colors.push(c0.r / 255, c0.g / 255, c0.b / 255);
                colors.push(c1.r / 255, c1.g / 255, c1.b / 255);
                colors.push(c2.r / 255, c2.g / 255, c2.b / 255);
            } else {
                // Default color: white for textured (texture * 1.0), gray for non-textured
                const defaultColor = isTextured ? 1.0 : 0.6;
                colors.push(defaultColor, defaultColor, defaultColor);
                colors.push(defaultColor, defaultColor, defaultColor);
                colors.push(defaultColor, defaultColor, defaultColor);
            }
        }

        if (positions.length === 0) continue;

        // Create geometry
        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        if (isTextured && uvs.length > 0) {
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }

        // Handle normals based on shading mode
        if (normalArray.length > 0) {
            // Use file normals
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalArray, 3));

            // For smooth shading with file normals, merge vertices to share normals at seams
            if (smoothShading) {
                geometry = BufferGeometryUtils.mergeVertices(geometry);
            }
        } else {
            // No file normals - compute them
            if (smoothShading) {
                // Merge vertices first so normals are averaged at shared positions
                geometry = BufferGeometryUtils.mergeVertices(geometry);
            }
            geometry.computeVertexNormals();
        }

        // Get material side based on hundret culling flags
        const side = getMaterialSide(hundret, cullingEnabled, invertCulling);

        // Polygon offset for z-fighting prevention
        const globalOrder = meshIndex * 100 + groupIdx;
        const offsetConfig = polygonOffset ? {
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: -globalOrder * 4,
        } : {};

        // Create material - always use MeshLambertMaterial for FF7-authentic Gouraud shading
        const material = isTextured
            ? new THREE.MeshLambertMaterial({
                map: textures[group.texID],
                vertexColors: true,
                side,
                transparent: true,
                alphaTest: 0.1,
                ...offsetConfig,
            })
            : new THREE.MeshLambertMaterial({
                vertexColors: true,
                side,
                ...offsetConfig,
            });

        const mesh = new THREE.Mesh(geometry, material);

        if (polygonOffset) {
            mesh.renderOrder = globalOrder;
        }

        meshGroup.add(mesh);
    }

    return meshGroup;
}

/**
 * Fit camera to view an object or bounding box
 *
 * @param {THREE.PerspectiveCamera} camera - The camera to position
 * @param {Object} controls - OrbitControls or TrackballControls
 * @param {THREE.Object3D|THREE.Box3} target - Object or bounding box to fit
 * @param {Object} options - Options
 * @param {boolean} [options.centerOnOrigin=false] - If true, orbit around origin instead of object center
 */
export function fitCameraToObject(camera, controls, target, options = {}) {
    const { centerOnOrigin = false } = options;

    // Get bounding box - either from object or use directly if it's a Box3
    const box = target.isBox3 ? target : new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDist = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraDist *= 1.5; // Add some margin

    // Determine orbit target
    const orbitTarget = centerOnOrigin ? new THREE.Vector3(0, 0, 0) : center;

    // Position camera offset from target
    camera.position.set(
        orbitTarget.x + cameraDist * 0.5,
        orbitTarget.y + cameraDist * 0.3,
        orbitTarget.z + cameraDist
    );
    camera.lookAt(orbitTarget);

    // Update controls
    controls.target.copy(orbitTarget);
    if (controls.minDistance !== undefined) {
        controls.minDistance = maxDim * 0.1;
        controls.maxDistance = maxDim * 10;
    }
    controls.update();

    // Update near/far planes based on model size
    camera.near = Math.max(0.01, maxDim / 100);
    camera.far = Math.max(1000, maxDim * 100);
    camera.updateProjectionMatrix();
}
