// FF7 PC Field Skeleton (HRC) file parser
// HRC files are plaintext skeleton definitions used for field models

export interface HRCBone {
    name: string;
    parentName: string;
    length: number;
    resourceCount: number;
    resources: string[];  // RSD file references (e.g., "AAAB")
}

export interface HRCData {
    headerBlock: number;
    skeletonName: string;
    boneCount: number;
    bones: HRCBone[];
}

export class HRCFile {
    data: HRCData;

    constructor(buffer: Uint8Array) {
        const text = new TextDecoder('ascii').decode(buffer);
        this.data = this.parse(text);
    }

    private parse(text: string): HRCData {
        const lines = text.split(/\r?\n/);
        let lineIndex = 0;

        // Helper to get next non-empty line
        const nextLine = (): string => {
            while (lineIndex < lines.length) {
                const line = lines[lineIndex++].trim();
                if (line.length > 0) return line;
            }
            return '';
        };

        // Parse header
        const headerLine = nextLine();
        if (!headerLine.startsWith(':HEADER_BLOCK')) {
            throw new Error('Invalid HRC file: missing HEADER_BLOCK');
        }
        const headerBlock = parseInt(headerLine.split(/\s+/)[1], 10);

        const skeletonLine = nextLine();
        if (!skeletonLine.startsWith(':SKELETON')) {
            throw new Error('Invalid HRC file: missing SKELETON');
        }
        const skeletonName = skeletonLine.split(/\s+/)[1] || '';

        const bonesLine = nextLine();
        if (!bonesLine.startsWith(':BONES')) {
            throw new Error('Invalid HRC file: missing BONES');
        }
        const boneCount = parseInt(bonesLine.split(/\s+/)[1], 10);

        // Parse bones
        const bones: HRCBone[] = [];
        for (let i = 0; i < boneCount; i++) {
            const name = nextLine();
            const parentName = nextLine();
            const length = parseFloat(nextLine());
            const resourceLine = nextLine();

            const resourceParts = resourceLine.split(/\s+/).filter(p => p.length > 0);
            const resourceCount = parseInt(resourceParts[0], 10) || 0;
            const resources = resourceParts.slice(1);

            bones.push({
                name,
                parentName,
                length,
                resourceCount,
                resources,
            });
        }

        return {
            headerBlock,
            skeletonName,
            boneCount,
            bones,
        };
    }

    // Build parent index map (for compatibility with skeleton visualization)
    getBoneParentIndex(boneIndex: number): number {
        const bone = this.data.bones[boneIndex];
        if (!bone) return -1;

        // "root" means no parent
        if (bone.parentName.toLowerCase() === 'root') {
            return -1;
        }

        // Find parent by name
        const parentIndex = this.data.bones.findIndex(
            b => b.name.toLowerCase() === bone.parentName.toLowerCase()
        );
        return parentIndex;
    }

    getStats() {
        const bonesWithModels = this.data.bones.filter(b => b.resourceCount > 0).length;
        return {
            type: 'Field Skeleton',
            name: this.data.skeletonName,
            bones: this.data.boneCount,
            bonesWithModels,
        };
    }

    // Generate list of related files
    getRelatedFiles(): { name: string; type: string }[] {
        const files: { name: string; type: string }[] = [];

        for (const bone of this.data.bones) {
            for (const rsd of bone.resources) {
                files.push({ name: `${rsd}.rsd`, type: 'Resource Definition' });
            }
        }

        return files;
    }
}
