<?php


namespace FirstTable\DebugBar\Explain;


use LeKoala\DebugBar\DebugBar;
use LeKoala\DebugBar\DebugBarController as BaseDebugBarController;
use SilverStripe\Control\HTTPRequest;
use SilverStripe\Control\HTTPResponse;
use SilverStripe\ORM\DB;
use SilverStripe\Security\SecurityToken;

/**
 * DebugBar's controller with EXPLAIN at /__debugbar/explain.
 *
 * Served in place of LeKoala\DebugBar\DebugBarController through the Injector.
 */
class Controller extends BaseDebugBarController
{

    private static $allowed_actions = [
        'index'   => true,
        'explain' => 'ADMIN',
    ];

    public function explain(HTTPRequest $request): HTTPResponse
    {
        $unavailable = static::unavailableReason();
        if ($unavailable) {
            return static::jsonResponse(['error' => $unavailable], 403);
        }

        if (!$request->isPOST()) {
            return static::jsonResponse(['error' => 'POST a sql parameter.'], 400);
        }

        if (!SecurityToken::inst()->checkRequest($request)) {
            return static::jsonResponse(['error' => 'Invalid security token.'], 400);
        }

        $sql = trim((string)$request->postVar('sql'));
        $parameters = static::parameters((string)$request->postVar('parameters'));
        if ($parameters === null) {
            return static::jsonResponse(['error' => 'Parameters could not be read.'], 400);
        }

        $rejection = static::rejectionReason($sql);
        if ($rejection) {
            return static::jsonResponse(['error' => $rejection], 400);
        }

        try {
            $explain = static::roundFiltered(iterator_to_array(DB::prepared_query('EXPLAIN ' . $sql, $parameters)));
            $warnings = iterator_to_array(DB::query('SHOW WARNINGS'));
            $indexes = static::indexes(static::tables($explain));
        } catch (\Exception $exception) {
            return static::jsonResponse(['error' => $exception->getMessage()], 400);
        }

        return static::jsonResponse([
            'explain'  => $explain,
            'indexes'  => $indexes,
            'warnings' => $warnings,
        ]);
    }

    protected static function unavailableReason(): ?string
    {
        $reasons = DebugBar::disabledCriteria();
        if ($reasons) {
            return 'DebugBar is not available: ' . implode(', ', $reasons) . '.';
        }

        return null;
    }

    /**
     * @return array<int, mixed>|null
     */
    protected static function parameters(string $encoded): ?array
    {
        if ($encoded === '') {
            return [];
        }

        $decoded = json_decode($encoded, true);
        if (!is_array($decoded)) {
            return null;
        }

        try {
            $parameters = [];
            foreach ($decoded as $parameter) {
                $parameters[] = static::bound($parameter);
            }
        } catch (\InvalidArgumentException) {
            return null;
        }

        return $parameters;
    }

    /**
     * @param mixed $parameter
     * @return mixed
     */
    protected static function bound($parameter)
    {
        if (!is_array($parameter)) {
            throw new \InvalidArgumentException('Parameter is not a value and type.');
        }

        if (!array_key_exists('value', $parameter)) {
            throw new \InvalidArgumentException('Parameter has no value.');
        }

        $type = $parameter['type'] ?? null;
        if (!is_string($type)) {
            throw new \InvalidArgumentException('Parameter has no type.');
        }

        $value = $parameter['value'];
        if (is_array($value)) {
            throw new \InvalidArgumentException('Parameter value is nested.');
        }

        if (is_string($value)) {
            $value = base64_decode($value, true);

            if ($value === false) {
                throw new \InvalidArgumentException('Parameter string could not be decoded.');
            }
        }

        return static::cast($value, $type);
    }

    /**
     * @param scalar|null $value
     * @return mixed
     */
    protected static function cast($value, string $type)
    {
        switch ($type) {
            case 'boolean':
                return (bool)$value;
            case 'integer':
                return (int)$value;
            case 'double':
            case 'float':
                return (float)$value;
            case 'string':
            case 'blob':
                if (!is_string($value)) {
                    throw new \InvalidArgumentException('Parameter is not a string.');
                }

                return $value;
            case 'NULL':
                return null;
        }

        throw new \InvalidArgumentException('Parameter type is not bound.');
    }

    protected static function rejectionReason(string $sql): ?string
    {
        if (!$sql) {
            return 'No statement given.';
        }

        if (!preg_match('/^SELECT\b/i', $sql)) {
            return 'Only SELECT statements can be explained.';
        }

        // Strip '…' literals so a ';' inside one is not treated as a second statement.
        $plain = preg_replace("/'(?:\\\\.|''|[^'])*'/", '', $sql) ?? $sql;
        if (str_contains(rtrim($plain, "; \t\n\r"), ';')) {
            return 'Only a single statement can be explained.';
        }

        return null;
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    protected static function roundFiltered(array $rows): array
    {
        foreach ($rows as $index => $row) {
            foreach ($row as $column => $value) {

                if (strtolower((string)$column) !== 'filtered') {
                    continue;
                }

                if (!is_numeric($value)) {
                    continue;
                }

                $rows[$index][$column] = number_format((float)$value, 2, '.', '') . '%';
            }
        }

        return $rows;
    }

    /**
     * Names the plan read a table under, without repeats, in the order the plan reached them.
     *
     * MySQL is inconsistent about the case of EXPLAIN column names, so the column is matched
     * without it.
     *
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, string>
     */
    protected static function tables(array $rows): array
    {
        $tables = [];

        foreach ($rows as $row) {
            foreach ($row as $column => $value) {

                if (strtolower((string)$column) !== 'table') {
                    continue;
                }

                $table = (string)$value;

                if (!$table) {
                    continue;
                }

                // A work table the optimiser named itself, such as <derived2> or <union1,2>, which
                // has no index of its own.
                if (str_starts_with($table, '<')) {
                    continue;
                }

                $tables[$table] = $table;
            }
        }

        return array_values($tables);
    }

    /**
     * Indexes on the tables given, one row per index with its parts in order.
     *
     * A name the plan reported that is not a table in this schema, an alias among them, has no
     * row here, so the lookup doubles as the check that the name is a real table.
     *
     * @param array<int, string> $tables
     * @return array<int, array<string, mixed>>
     */
    protected static function indexes(array $tables): array
    {
        if (!$tables) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($tables), '?'));

        $sql = <<<SQL
            SELECT
                TABLE_NAME,
                INDEX_NAME,
                COLUMN_NAME,
                SUB_PART,
                SEQ_IN_INDEX,
                INDEX_TYPE,
                NON_UNIQUE,
                CARDINALITY
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ($placeholders)
            SQL;

        return static::groupedIndexes(iterator_to_array(DB::prepared_query($sql, $tables)));
    }

    /**
     * One row per index, with its parts in order.
     *
     * A prefix index is not the same index as one over the whole column, so the length a part is
     * cut to is kept with the column it belongs to.
     *
     * @param array<int, array<string, mixed>> $parts
     * @return array<int, array<string, mixed>>
     */
    protected static function groupedIndexes(array $parts): array
    {
        $indexes = [];

        foreach ($parts as $part) {
            $table = (string)static::cell($part, 'TABLE_NAME');
            $name = (string)static::cell($part, 'INDEX_NAME');
            $key = $table . "\0" . $name;

            $index = $indexes[$key] ?? null;
            if (!$index) {
                $unique = 'No';
                if ((int)static::cell($part, 'NON_UNIQUE') === 0) {
                    $unique = 'Yes';
                }

                $index = $indexes[$key] = (object)[
                    'table'       => $table,
                    'index'       => $name,
                    'type'        => static::cell($part, 'INDEX_TYPE'),
                    'unique'      => $unique,
                    'cardinality' => null,
                    'columns'     => [],
                ];
            }

            $column = (string)static::cell($part, 'COLUMN_NAME');
            $prefix = static::cell($part, 'SUB_PART');
            $sequence = (int)static::cell($part, 'SEQ_IN_INDEX');
            if ($prefix === null) {
                $index->columns[$sequence] = $column;
            } else {
                $index->columns[$sequence] = $column . '(' . $prefix . ')';
            }

            $cardinality = static::cell($part, 'CARDINALITY');
            if (!is_numeric($cardinality)) {
                continue;
            }

            $value = (int)$cardinality;
            if ($index->cardinality === null) {
                $index->cardinality = $value;
                continue;
            }

            if ($value > $index->cardinality) {
                $index->cardinality = $value;
            }
        }

        $rows = [];
        foreach ($indexes as $index) {
            ksort($index->columns);
            $rows[] = [
                'table'       => $index->table,
                'index'       => $index->index,
                'columns'     => implode(', ', $index->columns),
                'type'        => $index->type,
                'unique'      => $index->unique,
                'cardinality' => $index->cardinality,
            ];
        }

        usort($rows, static function (array $left, array $right): int {
            $table = strcmp((string)$left['table'], (string)$right['table']);
            if ($table !== 0) {
                return $table;
            }

            return strcmp((string)$left['index'], (string)$right['index']);
        });

        return $rows;
    }

    /**
     * @param array<string, mixed> $row
     * @return mixed
     */
    protected static function cell(array $row, string $name)
    {
        foreach ($row as $column => $value) {
            if (strtolower((string)$column) === strtolower($name)) {
                return $value;
            }
        }

        return null;
    }

    protected static function jsonResponse(array $body, int $statusCode = 200): HTTPResponse
    {
        $response = HTTPResponse::create(json_encode($body), $statusCode);
        $response->addHeader('Content-Type', 'application/json');

        return $response;
    }
}
