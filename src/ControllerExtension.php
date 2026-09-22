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

        // CMS routing stubs never call includeRequirements; wait for the real page controller so our assets stay after the bar's.
        $isRootURLController = $this->owner instanceof RootURLController;
        $isModelAsController = $this->owner instanceof ModelAsController;
        $debugBarRequirementsIncluded = !$isRootURLController && !$isModelAsController;
        if (!$debugBarRequirementsIncluded) {
            return;
        }

        // Don't add the extension if  DebugBar is not running
        $debugBar = DebugBar::getDebugBar();
        if (!$debugBar) {
            return;
        }

        $needsParametersCollector = !$debugBar->hasCollector(ParametersCollector::NAME);
        if ($needsParametersCollector) {
            $debugBar->addCollector(new ParametersCollector());
        }

        Requirements::css('firsttable/debugbar-sql-explain:css/Explain.css');
        Requirements::javascript('firsttable/debugbar-sql-explain:javascript/Handle.js');
        Requirements::javascript('firsttable/debugbar-sql-explain:javascript/Explain.js');

        Requirements::customScript(
            'window.ftDebugBarExplainToken = ' . json_encode(SecurityToken::inst()->getValue()) . ';',
            'ft-debugbar-explain-token'
        );
    }
}
