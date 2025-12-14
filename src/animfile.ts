// FF7 PC Field Animation (.a) file parser
// Binary format based on Kimera's FF7FieldAnimation.cs

export interface FieldRotation {
    alpha: number;
    beta: number;
    gamma: number;
}

export interface FieldFrame {
    rootRotation: FieldRotation;
    rootTranslation: { x: number; y: number; z: number };
    boneRotations: FieldRotation[];
}

export interface FieldAnimationData {
    version: number;
    nFrames: number;
    nBones: number;
    rotationOrder: [number, number, number];
    frames: FieldFrame[];
}

export class FieldAnimation {
    data: FieldAnimationData;

    constructor(buffer: Uint8Array) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.data = this.parse(view);
    }

    private parse(view: DataView): FieldAnimationData {
        let offset = 0;

        // Header
        const version = view.getInt32(offset, true);
        offset += 4;
        
        const nFrames = view.getInt32(offset, true);
        offset += 4;
        
        const nBones = view.getInt32(offset, true);
        offset += 4;

        // Rotation order (3 bytes) + unused (1 byte)
        const rotationOrder: [number, number, number] = [
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
        ];
        offset += 4; // includes unused byte

        // Runtime data (5 int32s) - skip
        offset += 20;

        // Parse frames
        const frames: FieldFrame[] = [];
        
        for (let fi = 0; fi < nFrames; fi++) {
            // Root rotation (alpha, beta, gamma)
            const rootRotation: FieldRotation = {
                alpha: view.getFloat32(offset, true),
                beta: view.getFloat32(offset + 4, true),
                gamma: view.getFloat32(offset + 8, true),
            };
            offset += 12;

            // Root translation (x, y, z)
            const rootTranslation = {
                x: view.getFloat32(offset, true),
                y: view.getFloat32(offset + 4, true),
                z: view.getFloat32(offset + 8, true),
            };
            offset += 12;

            // Bone rotations
            const boneRotations: FieldRotation[] = [];
            const boneCount = nBones > 0 ? nBones : 1;
            
            for (let bi = 0; bi < boneCount; bi++) {
                boneRotations.push({
                    alpha: view.getFloat32(offset, true),
                    beta: view.getFloat32(offset + 4, true),
                    gamma: view.getFloat32(offset + 8, true),
                });
                offset += 12;
            }

            frames.push({
                rootRotation,
                rootTranslation,
                boneRotations,
            });
        }

        return {
            version,
            nFrames,
            nBones,
            rotationOrder,
            frames,
        };
    }

    getFrame(index: number): FieldFrame | null {
        if (index < 0 || index >= this.data.frames.length) {
            return null;
        }
        return this.data.frames[index];
    }

    getFirstFrame(): FieldFrame | null {
        return this.getFrame(0);
    }
}
