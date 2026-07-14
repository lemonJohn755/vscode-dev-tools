declare module 'archiver' {
    import * as stream from 'stream';
    import { ZlibOptions } from 'zlib';

    interface CoreOptions {
        statConcurrency?: number;
    }

    interface TransformOptions {
        allowHalfOpen?: boolean;
        readableObjectMode?: boolean;
        writableObjectMode?: boolean;
        decodeStrings?: boolean;
        encoding?: BufferEncoding;
        highWaterMark?: number;
        objectMode?: boolean;
    }

    interface ZipOptions {
        comment?: string;
        forceLocalTime?: boolean;
        forceZip64?: boolean;
        namePrependSlash?: boolean;
        store?: boolean;
        level?: number;
        zlib?: ZlibOptions;
    }

    interface EntryData {
        name: string;
        type?: 'directory' | 'file' | 'symlink';
        date?: Date | string;
        mode?: number;
        prefix?: string;
        stats?: import('fs').Stats;
    }

    interface ArchiverError extends Error {
        code: string;
        data?: any;
    }

    interface ProgressData {
        entries: {
            total: number;
            processed: number;
        };
        fs: {
            totalBytes: number;
            processedBytes: number;
        };
    }

    interface Archiver extends stream.Transform {
        abort(): this;
        append(source: stream.Readable | Buffer | string, data?: EntryData): this;
        directory(dirpath: string, destpath: false | string, data?: Partial<EntryData>): this;
        file(filename: string, data?: EntryData): this;
        glob(pattern: string, options?: any, data?: Partial<EntryData>): this;
        finalize(): Promise<void>;
        pointer(): number;
        symlink(filepath: string, target: string, mode?: number): this;
        on(event: 'error' | 'warning', listener: (error: ArchiverError) => void): this;
        on(event: 'data', listener: (data: Buffer) => void): this;
        on(event: 'progress', listener: (progress: ProgressData) => void): this;
        on(event: 'close' | 'drain' | 'finish', listener: () => void): this;
        on(event: 'pipe' | 'unpipe', listener: (src: stream.Readable) => void): this;
        on(event: 'entry', listener: (entry: EntryData) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
    }

    type Format = 'zip' | 'tar' | 'json';

    type ArchiverOptions = CoreOptions & TransformOptions & ZipOptions;

    function archiver(format: Format, options?: ArchiverOptions): Archiver;

    namespace archiver {
        function create(format: Format, options?: ArchiverOptions): Archiver;
        function registerFormat(format: string, module: any): void;
        function isRegisteredFormat(format: string): boolean;
    }

    export = archiver;
}
