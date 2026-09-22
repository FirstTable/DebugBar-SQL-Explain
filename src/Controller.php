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
        $unavailable = $this->unavailableReason();
        if ($unavailable) {
            return $this->jsonResponse(['error' => $unavailable], 403);
        }

        if (!$request->isPOST()) {
            return $this->jsonResponse(['error' => 'POST a sql parameter.'], 400);
        }

        if (!SecurityToken::inst()->checkRequest($request)) {
            return $this->jsonResponse(['error' => 'Invalid security token.'], 400);
        }

        $sql = trim((string)$request->postVar('sql'));
        $parameters = $this->parameters((string)$request->postVar('parameters'));
        if ($parameters === null) {
            return $this->jsonResponse(['error' => 'Parameters could not be read.'], 400);
        }

        $rejection = $this->rejectionReason($sql);
        if ($rejection) {
            return $this->jsonResponse(['error' => $rejection], 400);
        }

        try {
            $explain = $this->roundFiltered(iterator_to_array(DB::prepared_query('EXPLAIN ' . $sql, $parameters)));
            $warnings = iterator_to_array(DB::query('SHOW WARNINGS'));
        } catch (\Exception $exception) {
            return $this->jsonResponse(['error' => $exception->getMessage()], 400);
        }

        return $this->jsonResponse([
            'explain'  => $explain,
            'warnings' => $warnings,
        ]);
    }

    protected function unavailableReason(): ?string
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
    protected function parameters(string $encoded): ?array
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
                $parameters[] = $this->bound($parameter);
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
    protected function bound($parameter)
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

        return $this->cast($value, $type);
    }

    /**
     * @param scalar|null $value
     * @return mixed
     */
    protected function cast($value, string $type)
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

    protected function rejectionReason(string $sql): ?string
    {
        if (!$sql) {
            return 'No statement given.';
        }

        if (!preg_match('/^SELECT\b/i', $sql)) {
            return 'Only SELECT statements can be explained.';
        }

        if (str_contains(rtrim($sql, "; \t\n\r"), ';')) {
            return 'Only a single statement can be explained.';
        }

        return null;
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    protected function roundFiltered(array $rows): array
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

    protected function jsonResponse(array $body, int $statusCode = 200): HTTPResponse
    {
        $response = HTTPResponse::create(json_encode($body), $statusCode);
        $response->addHeader('Content-Type', 'application/json');

        return $response;
    }
}
