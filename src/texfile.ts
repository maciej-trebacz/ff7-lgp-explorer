import {Parser} from 'binary-parser';

export interface WorldMapTexture {
    id: number;
    name: string;
    width: number;
    height: number;
    uOffset: number;
    vOffset: number;
    tex?: TexFile;
    animated?: boolean;
    frames?: number;
    imageData?: string;
}

interface PixelFormat {
    redBits: number;
    greenBits: number;
    blueBits: number;
    alphaBits: number;
    redMask: number;
    greenMask: number;
    blueMask: number;
    alphaMask: number;
    redShift: number;
    greenShift: number;
    blueShift: number;
    alphaShift: number;
    redLoss: number;
    greenLoss: number;
    blueLoss: number;
    alphaLoss: number;
    redMax: number;
    greenMax: number;
    blueMax: number;
    alphaMax: number;
}

interface TexData {
    version: number;
    colorKeyFlag: number;
    minBitsPerColor: number;
    maxBitsPerColor: number;
    minAlphaBits: number;
    maxAlphaBits: number;
    minBitsPerPixel: number;
    maxBitsPerPixel: number;
    numPalettes: number;
    colorsPerPalette: number;
    bitDepth: number;
    width: number;
    height: number;
    bytesPerRow: number;
    paletteFlag: number;
    bitsPerIndex: number;
    indexedTo8bit: number;
    paletteSize: number;
    colorsPerPaletteAgain: number;
    bitsPerPixel: number;
    bytesPerPixel: number;
    pixelFormat: PixelFormat;
    colorKeyArrayFlag: number;
    referenceAlpha: number;
    paletteIndex: number;
    palette?: Uint8Array;
    pixels: Uint8Array;
    colorKeyArray?: Uint8Array;
    // Internal fields from parser
    _formatIndicator: number;
    _headerSize: number;
}

const pixelFormatParser = new Parser()
    .uint32le('redBits')
    .uint32le('greenBits')
    .uint32le('blueBits')
    .uint32le('alphaBits')
    .uint32le('redMask')
    .uint32le('greenMask')
    .uint32le('blueMask')
    .uint32le('alphaMask')
    .uint32le('redShift')
    .uint32le('greenShift')
    .uint32le('blueShift')
    .uint32le('alphaShift')
    .uint32le('redLoss')
    .uint32le('greenLoss')
    .uint32le('blueLoss')
    .uint32le('alphaLoss')
    .uint32le('redMax')
    .uint32le('greenMax')
    .uint32le('blueMax')
    .uint32le('alphaMax');

// TEX header parser that handles both standard (236 bytes) and alternative (232 bytes) formats.
// The difference is a 4-byte field at offset 0x2C that's present in standard format but absent in alternative.
// Detection: In standard format, 0x2C is a padding field (always 0). In alternative format, 0x2C is numPalettes (non-zero).
// We read the value at 0x2C, then use seek() to rewind if it's non-zero (meaning we need to re-read it as numPalettes).
const texHeaderParser = new Parser()
    .uint32le('version')
    .skip(4) // Unknown
    .uint32le('colorKeyFlag')
    .skip(8) // Unknown
    .uint32le('minBitsPerColor')
    .uint32le('maxBitsPerColor')
    .uint32le('minAlphaBits')
    .uint32le('maxAlphaBits')
    .uint32le('minBitsPerPixel')
    .uint32le('maxBitsPerPixel')
    // Read potential skip field at 0x2C - determines format variant
    .uint32le('_formatIndicator')
    .seek(function() {
        // If non-zero, this is actually numPalettes (alternative format), so rewind to re-read it
        // @ts-ignore - binary-parser types don't include 'this' context
        return this._formatIndicator !== 0 ? -4 : 0;
    })
    .uint32le('numPalettes')
    .uint32le('colorsPerPalette')
    .uint32le('bitDepth')
    .uint32le('width')
    .uint32le('height')
    .uint32le('bytesPerRow')
    .skip(4) // Unknown
    .uint32le('paletteFlag')
    .uint32le('bitsPerIndex')
    .uint32le('indexedTo8bit')
    .uint32le('paletteSize')
    .uint32le('colorsPerPaletteAgain')
    .skip(4) // Runtime data
    .uint32le('bitsPerPixel')
    .uint32le('bytesPerPixel')
    .nest('pixelFormat', {
        type: pixelFormatParser
    })
    .uint32le('colorKeyArrayFlag')
    .skip(4) // Runtime data
    .uint32le('referenceAlpha')
    .skip(36) // Runtime data and unknown
    .saveOffset('_headerSize'); // Captures actual header size (0xEC or 0xE8)

// Validate that parsed TEX data has reasonable values
function isValidTexData(data: TexData): boolean {
    return (
        data.width > 0 && data.width <= 4096 &&
        data.height > 0 && data.height <= 4096 &&
        data.bitDepth > 0 && data.bitDepth <= 32 &&
        data.bytesPerPixel > 0 && data.bytesPerPixel <= 4
    );
}

export class TexFile {
    data: TexData;

    constructor(data: Uint8Array) {
        // Parse the header - the parser auto-detects format variant via seek()
        let header: TexData;
        try {
            header = texHeaderParser.parse(data);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Failed to parse TEX header: ${msg}`);
        }

        // Validate parsed data
        if (!isValidTexData(header)) {
            throw new Error(
                `Invalid TEX data: ${header.width}x${header.height}, ` +
                `bitDepth=${header.bitDepth}, bytesPerPixel=${header.bytesPerPixel}`
            );
        }

        this.data = header;
        let offset = this.data._headerSize;

        // Read palette if present
        if (this.data.paletteFlag !== 0) {
            const paletteSize = this.data.paletteSize * 4;
            if (offset + paletteSize > data.length) {
                throw new Error(`TEX file truncated: expected palette at offset ${offset}, file size ${data.length}`);
            }
            this.data.palette = data.slice(offset, offset + paletteSize);
            offset += paletteSize;
        }

        // Read pixel data
        const pixelDataSize = this.data.width * this.data.height * this.data.bytesPerPixel;
        if (offset + pixelDataSize > data.length) {
            throw new Error(
                `TEX file truncated: expected ${pixelDataSize} bytes of pixel data at offset ${offset}, ` +
                `file size ${data.length}`
            );
        }
        this.data.pixels = data.slice(offset, offset + pixelDataSize);
        offset += pixelDataSize;

        // Read color key array if present
        if (this.data.colorKeyArrayFlag !== 0) {
            const colorKeyArraySize = this.data.numPalettes;
            if (offset + colorKeyArraySize <= data.length) {
                this.data.colorKeyArray = data.slice(offset, offset + colorKeyArraySize);
            }
        }
    }

    getPixels(paletteIndex = 0): Uint8Array {
        const numPixels = this.data.width * this.data.height;
        const output = new Uint8Array(numPixels * 4);

        if (this.data.paletteFlag !== 0) {
            // Palette mode - each pixel is an index into the palette
            // Calculate actual colors per palette from paletteSize / numPalettes
            // (colorsPerPalette header field can be incorrect in some files)
            const actualColorsPerPalette = this.data.numPalettes > 0 
                ? Math.floor(this.data.paletteSize / this.data.numPalettes)
                : this.data.colorsPerPalette;
            const paletteOffset = paletteIndex * actualColorsPerPalette * 4;
            for (let i = 0; i < numPixels; i++) {
                const colorIndex = this.data.pixels[i] * 4 + paletteOffset;
                output[i * 4] = this.data.palette![colorIndex + 2];     // R
                output[i * 4 + 1] = this.data.palette![colorIndex + 1]; // G 
                output[i * 4 + 2] = this.data.palette![colorIndex]; // B
                output[i * 4 + 3] = this.data.palette![colorIndex + 3]; // A
            }
        } else {
            // Direct color mode - use pixel format
            const format = this.data.pixelFormat;
            const bytesPerPixel = this.data.bytesPerPixel;

            for (let i = 0; i < numPixels; i++) {
                const pixelOffset = i * bytesPerPixel;
                const pixel = new DataView(this.data.pixels.buffer, pixelOffset, bytesPerPixel);
                const value = bytesPerPixel === 2 ? pixel.getUint16(0, true) : pixel.getUint32(0, true);

                // Extract color components using masks and shifts
                const r = ((value & format.redMask) >> format.redShift) << (8 - format.redBits);
                const g = ((value & format.greenMask) >> format.greenShift) << (8 - format.greenBits);
                const b = ((value & format.blueMask) >> format.blueShift) << (8 - format.blueBits);
                const a = format.alphaBits > 0 
                    ? ((value & format.alphaMask) >> format.alphaShift) << (8 - format.alphaBits)
                    : 255;

                output[i * 4] = r;
                output[i * 4 + 1] = g;
                output[i * 4 + 2] = b;
                output[i * 4 + 3] = a;
            }
        }

        return output;
    }

    writeFile(): Uint8Array {
        const paletteSize = this.data.paletteFlag !== 0 ? this.data.paletteSize * 4 : 0;
        const pixelDataSize = this.data.width * this.data.height * this.data.bytesPerPixel;
        const colorKeyArraySize = this.data.colorKeyArrayFlag !== 0 ? this.data.numPalettes : 0;
        const totalSize = 0xEC + paletteSize + pixelDataSize + colorKeyArraySize;

        const out = new Uint8Array(totalSize);
        const view = new DataView(out.buffer);
        let offset = 0;

        // Write header
        view.setUint32(offset, this.data.version, true);
        offset += 4;
        offset += 4; // Skip unknown
        view.setUint32(offset, this.data.colorKeyFlag, true);
        offset += 4;
        offset += 12; // Skip unknown
        view.setUint32(offset, this.data.minBitsPerColor, true);
        offset += 4;
        view.setUint32(offset, this.data.maxBitsPerColor, true);
        offset += 4;
        view.setUint32(offset, this.data.minAlphaBits, true);
        offset += 4;
        view.setUint32(offset, this.data.maxAlphaBits, true);
        offset += 4;
        view.setUint32(offset, this.data.minBitsPerPixel, true);
        offset += 4;
        view.setUint32(offset, this.data.maxBitsPerPixel, true);
        offset += 4;
        offset += 4; // Skip unknown
        view.setUint32(offset, this.data.numPalettes, true);
        offset += 4;
        view.setUint32(offset, this.data.colorsPerPalette, true);
        offset += 4;
        view.setUint32(offset, this.data.bitDepth, true);
        offset += 4;
        view.setUint32(offset, this.data.width, true);
        offset += 4;
        view.setUint32(offset, this.data.height, true);
        offset += 4;
        view.setUint32(offset, this.data.bytesPerRow, true);
        offset += 4;
        offset += 4; // Skip unknown
        view.setUint32(offset, this.data.paletteFlag, true);
        offset += 4;
        view.setUint32(offset, this.data.bitsPerIndex, true);
        offset += 4;
        view.setUint32(offset, this.data.indexedTo8bit, true);
        offset += 4;
        view.setUint32(offset, this.data.paletteSize, true);
        offset += 4;
        view.setUint32(offset, this.data.colorsPerPaletteAgain, true);
        offset += 4;
        offset += 4; // Skip runtime data
        view.setUint32(offset, this.data.bitsPerPixel, true);
        offset += 4;
        view.setUint32(offset, this.data.bytesPerPixel, true);
        offset += 4;

        // Write pixel format
        view.setUint32(offset, this.data.pixelFormat.redBits, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.greenBits, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.blueBits, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.alphaBits, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.redMask, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.greenMask, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.blueMask, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.alphaMask, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.redShift, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.greenShift, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.blueShift, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.alphaShift, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.redLoss, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.greenLoss, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.blueLoss, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.alphaLoss, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.redMax, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.greenMax, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.blueMax, true);
        offset += 4;
        view.setUint32(offset, this.data.pixelFormat.alphaMax, true);
        offset += 4;

        view.setUint32(offset, this.data.colorKeyArrayFlag, true);
        offset += 4;
        offset += 4; // Skip runtime data
        view.setUint32(offset, this.data.referenceAlpha, true);
        offset += 4;
        offset += 24; // Skip runtime data and unknown
        view.setUint32(offset, this.data.paletteIndex, true);
        offset += 4;
        offset += 20; // Skip unknown

        // Write palette data if present
        if (this.data.paletteFlag !== 0 && this.data.palette) {
            out.set(this.data.palette, offset);
            offset += this.data.palette.length;
        }

        // Write pixel data
        out.set(this.data.pixels, offset);
        offset += this.data.pixels.length;

        // Write color key array if present
        if (this.data.colorKeyArrayFlag !== 0 && this.data.colorKeyArray) {
            out.set(this.data.colorKeyArray, offset);
        }

        return out;
    }
} 