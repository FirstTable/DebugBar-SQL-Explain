<?php


namespace FirstTable\DebugBar\Explain;


use LeKoala\DebugBar\DebugBar;
use LeKoala\DebugBar\Extension\ControllerExtension as BaseControllerExtension;
use SilverStripe\CMS\Controllers\ModelAsController;
use SilverStripe\CMS\Controllers\RootURLController;
use SilverStripe\Security\SecurityToken;
use SilverStripe\View\Requirements;

/**
 * DebugBar's controller extension: EXPLAIN assets and the parameters collector.
 *
 * Served in place of LeKoala\DebugBar\Extension\ControllerExtension through the Injector.
 */
class ControllerExtension extends BaseControllerExtension
{

    public function onAfterInit()
    {
        parent::onAfterInit();

        // Same early exits as the parent: those controllers never call includeRequirements, and
        // registering our scripts here would put them ahead of the bar's own assets.
        if ($this->owner instanceof RootURLController) {
            return;
        }

        if ($this->owner instanceof ModelAsController) {
            return;
        }

        $debugBar = DebugBar::getDebugBar();
        if (!$debugBar) {
            return;
        }

        if (!$debugBar->hasCollector(ParametersCollector::NAME)) {
            $debugBar->addCollector(new ParametersCollector());
        }

        // Path packages expose under resources/packages/… (realpath), not resources/vendor/…
        Requirements::css('resources/packages/debugbar-sql-explain/css/Explain.css');
        Requirements::javascript('resources/packages/debugbar-sql-explain/javascript/Handle.js');
        Requirements::javascript('resources/packages/debugbar-sql-explain/javascript/Explain.js');

        Requirements::customScript(
            'window.ftDebugBarExplainToken = ' . json_encode(SecurityToken::inst()->getValue()) . ';',
            'ft-debugbar-explain-token'
        );
    }
}
