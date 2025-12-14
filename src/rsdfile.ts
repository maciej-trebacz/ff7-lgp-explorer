// FF7 PC Field Resource Definition (RSD) file parser
// RSD files are plaintext files that reference .P models and .TEX textures

export interface RSDData {
    id: string;              // Always "@RSD940102"
    plyFile: string;         // PLY reference (e.g., "AAAC.PLY")
    matFile: string;         // MAT reference (e.g., "AAAC.MAT")
    grpFile: string;         // GRP reference (e.g., "AAAC.GRP")
    numTextures: number;     // Number of textures
    textures: string[];      // TEX file references (stored as .TIM in RSD, but actual files are .TEX)
}

export class RSDFile {
    data: RSDData;

    constructor(buffer: Uint8Array) {
        const text = new TextDecoder('ascii').decode(buffer);
        this.data = this.parse(text);
    }

    private parse(text: string): RSDData {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        const data: RSDData = {
            id: '',
            plyFile: '',
            matFile: '',
            grpFile: '',
            numTextures: 0,
            textures: [],
        };

        for (const line of lines) {
            if (line.startsWith('@RSD')) {
                data.id = line;
            } else if (line.startsWith('PLY=')) {
                data.plyFile = line.substring(4);
            } else if (line.startsWith('MAT=')) {
                data.matFile = line.substring(4);
            } else if (line.startsWith('GRP=')) {
                data.grpFile = line.substring(4);
            } else if (line.startsWith('NTEX=')) {
                data.numTextures = parseInt(line.substring(5), 10) || 0;
            } else if (line.startsWith('TEX[')) {
                // TEX[0]=AABB.TIM -> extract AABB.TIM
                const match = line.match(/TEX\[\d+\]=(.+)/);
                if (match) {
                    data.textures.push(match[1]);
                }
            }
        }

        return data;
    }

    // Get the .P model filename (PLY references .PLY but actual file is .P)
    getPModelFilename(): string {
        if (!this.data.plyFile) return '';
        // Replace .PLY extension with .P (case insensitive)
        return this.data.plyFile.replace(/\.PLY$/i, '.P');
    }

    // Get .TEX filenames (RSD stores .TIM references but actual files are .TEX)
    getTextureFilenames(): string[] {
        return this.data.textures.map(tex => 
            tex.replace(/\.TIM$/i, '.TEX')
        );
    }

    getStats() {
        return {
            pModel: this.getPModelFilename(),
            textures: this.getTextureFilenames(),
            numTextures: this.data.numTextures,
        };
    }
}
