<?php


namespace FirstTable\DebugBar\Explain;


use DebugBar\DataCollector\DataCollector;

/**
 * Carries the recorded statement parameters to the browser in the DebugBar's own payload.
 *
 * The collector has no widget of its own. Its data is read by the EXPLAIN button, which posts
 * the parameters back so they can be bound again with the types they were bound with.
 */
class ParametersCollector extends DataCollector
{

    const NAME = 'ftqueryparameters';

    public function getName(): string
    {
        return self::NAME;
    }

    /**
     * @return array<string, array<string, string>>
     */
    public function collect(): array
    {
        return ProxyDBExtension::getStatements();
    }
}
