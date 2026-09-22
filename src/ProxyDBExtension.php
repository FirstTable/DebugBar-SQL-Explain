<?php


namespace FirstTable\DebugBar\Explain;


use LeKoala\DebugBar\DebugBar;
use LeKoala\DebugBar\Extension\ProxyDBExtension as BaseProxyDBExtension;
use SilverStripe\ORM\DB;
use TractorCow\ClassProxy\Generators\ProxyGenerator;

/**
 * DebugBar's ProxyDBExtension, with typed statement parameters kept for EXPLAIN.
 *
 * Served in place of LeKoala\DebugBar\Extension\ProxyDBExtension through the Injector.
 *
 * Uses self:: rather than static:: — the proxy binds the benchmarkQuery closure to the database
 * instance, and that late-static class follows into every method the closure calls.
 */
class ProxyDBExtension extends BaseProxyDBExtension
{

    /**
     * @var array<string, array<string, string>>
     */
    protected static $statements = [];

    /**
     * @var bool|null Null until the DebugBar's criteria have been read.
     */
    protected static $available = null;

    public function updateProxy(ProxyGenerator &$proxy)
    {
        parent::updateProxy($proxy);

        $proxy = $proxy->addMethod('benchmarkQuery', function ($args, $next) {
            self::record($args);

            return $next(...$args);
        });
    }

    /**
     * @return array<string, array<string, string>>
     */
    public static function getStatements(): array
    {
        return self::$statements;
    }

    protected static function available(): bool
    {
        if (self::$available !== null) {
            return self::$available;
        }

        self::$available = false;

        return self::$available = !DebugBar::disabledCriteria();
    }

    /**
     * @param array<mixed> $args
     */
    protected static function record(array $args): void
    {
        if (!self::available()) {
            return;
        }

        $args += [
            0 => '',
            1 => 0,
            2 => []
        ];
        list($sql, $callback, $parameters) = $args;

        if (is_array($sql)) {
            list($sql, $parameters) = $sql;
        }

        $encoded = json_encode(array_map([self::class, 'encoded'], $parameters));

        if ($encoded === false) {
            return;
        }

        self::$statements[self::displayed($sql, $parameters)] = [
            'sql'        => $sql,
            'parameters' => $encoded,
        ];
    }

    /**
     * @param mixed $parameter
     * @return array{value: mixed, type: string}
     */
    protected static function encoded($parameter): array
    {
        $value = is_array($parameter) ? $parameter['value'] : $parameter;
        $type = is_array($parameter) ? $parameter['type'] : gettype($value);

        return [
            'value' => is_string($value) ? base64_encode($value) : $value,
            'type'  => $type,
        ];
    }

    /**
     * @param array<mixed> $parameters
     */
    protected static function displayed(string $sql, array $parameters): string
    {
        return preg_replace('/[[:blank:]]+/', ' ', trim(DB::inline_parameters($sql, $parameters))) ?? '';
    }
}
