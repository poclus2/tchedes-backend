import Module from 'module';
const originalRequire = Module.prototype.require;

(Module.prototype as any).require = function (id: string) {
    if (id === '@tensorflow/tfjs-node') {
        return originalRequire.apply(this, ['@tensorflow/tfjs'] as any);
    }
    return originalRequire.apply(this, arguments as any);
};
