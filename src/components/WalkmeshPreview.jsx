import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { calculateWalkmeshBounds } from '../fieldfile.ts';

const CAMERA_HEIGHT = 10000;

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

export function WalkmeshPreview({ walkmesh, gateways, wireframe, showGateways, showTriangleIds, rotation, onResetRequest }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const controlsRef = useRef(null);
    const rendererRef = useRef(null);
    const meshGroupRef = useRef(null);
    const resetFnRef = useRef(null);
    const triangleSpritesRef = useRef([]);

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

        const QUAD_SIZE = 20;
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
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111111);
        sceneRef.current = scene;

        // Orthographic camera (top-down view)
        const margin = 200;
        const containerAspect = width / height;
        const mapAspect = dimensions.width / dimensions.height || 1;

        let halfHeight = Math.max(dimensions.height, 500) / 2 + margin;
        let halfWidth = Math.max(dimensions.width, 500) / 2 + margin;

        if (containerAspect > mapAspect) {
            halfWidth = halfHeight * containerAspect;
        } else {
            halfHeight = halfWidth / containerAspect;
        }

        const camera = new THREE.OrthographicCamera(
            -halfWidth, halfWidth,
            halfHeight, -halfHeight,
            -100000, 100000
        );
        camera.position.set(dimensions.center.x, CAMERA_HEIGHT, dimensions.center.z);
        camera.lookAt(dimensions.center.x, 0, dimensions.center.z);
        cameraRef.current = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Controls - orbit style like RSDPreview
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true; // Shift+drag to pan
        controls.target.set(dimensions.center.x, 0, dimensions.center.z);
        controls.update();
        controlsRef.current = controls;

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

        // Main mesh
        const meshMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: wireframe ? 0.3 : 0.8,
            polygonOffset: wireframe,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
        });
        const mesh = new THREE.Mesh(geometries.meshGeo, meshMaterial);
        innerGroup.add(mesh);

        // Edge lines (wireframe)
        if (wireframe) {
            const edgeMaterial = new THREE.LineBasicMaterial({
                color: 0x3E4C5E,
                opacity: 0.4,
                transparent: true,
            });
            const edgeLines = new THREE.LineSegments(geometries.edgeGeo, edgeMaterial);
            innerGroup.add(edgeLines);

            // Blocked edges
            const blockedMaterial = new THREE.LineBasicMaterial({
                color: 0xeeeeff,
                opacity: 0.5,
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

        // Apply rotation
        meshGroup.rotation.y = rotation;

        // Reset function
        const setupCamera = () => {
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
        };

        resetFnRef.current = setupCamera;

        // Handle resize
        const handleResize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            const aspect = w / h;
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
            renderer.setSize(w, h);
        };

        window.addEventListener('resize', handleResize);

        // Limit zoom
        const handleCameraChange = () => {
            if (camera.zoom < 0.1) {
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
        const animate = () => {
            animationId = requestAnimationFrame(animate);
            controls.update();

            // Scale triangle ID sprites inversely with zoom, clamped to min/max bounds
            const rawScale = BASE_SPRITE_SCALE / camera.zoom;
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
    }, [geometries, gatewayGeometries, dimensions, wireframe, showGateways, showTriangleIds, walkmesh, rotation]);

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
