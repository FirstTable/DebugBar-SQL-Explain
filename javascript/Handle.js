/**
 * Publishes the DebugBar instance as `window.debugBar`.
 *
 * The bar boots from a module script, deliberately, so that it keeps out of the global scope,
 * which leaves a page no way to reach the bar it is showing. Wrapping a method the bar calls
 * while it starts up is the only handle on offer, and it has to be in place before the module
 * runs: this file is loaded after the bar's own assets, and a module is deferred until last.
 */
(function () {
    if (!window.PhpDebugBar) {
        return;
    }

    var addIndicator = PhpDebugBar.DebugBar.prototype.addIndicator;

    PhpDebugBar.DebugBar.prototype.addIndicator = function () {
        window.debugBar = this;

        return addIndicator.apply(this, arguments);
    };
})();
