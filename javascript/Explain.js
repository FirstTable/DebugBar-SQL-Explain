/**
 * Adds an EXPLAIN button to every statement in the DebugBar's database tab.
 *
 * The widget is patched rather than replaced because DebugBar constructs its collectors with a
 * hard `new DatabaseCollector`, so there is no injection point on the PHP side.
 */
(function () {
    if (!window.PhpDebugBar || !PhpDebugBar.Widgets || !PhpDebugBar.Widgets.SQLQueriesWidget) {
        return;
    }

    var COLLECTOR = 'ftqueryparameters';

    /**
     * The collector replaces SELECT lists over 100 characters with a placeholder and sends the
     * real list separately, so the displayed statement is not runnable until it is put back.
     */
    function fullStatement(stmt) {
        if (typeof stmt.params === 'string' && stmt.params) {
            return stmt.sql.replace('"ClickToShowFields"', stmt.params);
        }

        return stmt.sql;
    }

    /**
     * Clauses start a line of their own, and the ones that belong to the clause above are
     * indented under it.
     */
    var CLAUSE = /\s*\b(SELECT DISTINCT|SELECT|FROM|(?:LEFT|RIGHT|INNER|CROSS|FULL)(?: OUTER)? JOIN|JOIN|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|UNION ALL|UNION|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|AND|OR)\b/gi;

    var INDENTED = /JOIN|^(AND|OR)$/i;

    /**
     * Splits a statement into quoted and unquoted runs, so a keyword inside a value or a column
     * name is never mistaken for one in the statement itself.
     */
    function runs(sql) {
        return sql.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|[^'"`]+/g) || [];
    }

    /**
     * A select on a DataObject lists every column of every table in its ancestry, and the whole
     * list arrives as one line. Each entry gets a line of its own, indented under the clause.
     *
     * Only commas outside parentheses are broken: the ones inside belong to an `IN` list or to a
     * function's arguments, which read better kept together.
     *
     * The depth is carried in by the caller rather than counted here, because a parenthesis and
     * its pair can sit either side of a quoted value, which is a run of its own.
     */
    function breakEntries(run, parentheses) {
        var broken = '';

        for (var i = 0; i < run.length; i++) {
            var character = run.charAt(i);

            if (character === '(') {
                parentheses.depth++;
            } else if (character === ')') {
                // Clamped, because a depth that went negative on a statement we mis-split would
                // silently stop breaking every entry after it.
                parentheses.depth = Math.max(0, parentheses.depth - 1);
            } else if (character === ',' && parentheses.depth === 0) {
                broken += ',\n  ';

                // The space that followed the comma would otherwise widen the indent under it.
                while (run.charAt(i + 1) === ' ') {
                    i++;
                }

                continue;
            }

            broken += character;
        }

        return broken;
    }

    /**
     * Statements arrive as one long line, or broken wherever the query builder happened to break
     * them, which makes the shape of a query hard to read. This lays them out a clause per line.
     */
    function beautify(sql) {
        var parentheses = {depth: 0};

        var formatted = runs(sql).map(function (run) {
            if (/^['"`]/.test(run)) {
                return run;
            }

            var clauses = run.replace(/\s+/g, ' ').replace(CLAUSE, function (match, keyword) {
                return (INDENTED.test(keyword) ? '\n  ' : '\n') + keyword;
            });

            return breakEntries(clauses, parentheses);
        }).join('');

        return formatted.trim();
    }

    /**
     * Splits a select list on its top level commas. A comma inside parentheses belongs to an `IN`
     * list or to a function's arguments, and a comma inside a quoted value is not a separator at
     * all.
     */
    function splitEntries(list) {
        var entries = [];
        var current = '';
        var depth = 0;

        runs(list).forEach(function (run) {
            if (/^['"`]/.test(run)) {
                current += run;
                return;
            }

            // An entry can carry the line breaks the query builder left in it, and a cell is one
            // line, so they are collapsed here rather than rendered.
            run = run.replace(/\s+/g, ' ');

            for (var i = 0; i < run.length; i++) {
                var character = run.charAt(i);

                if (character === '(') {
                    depth++;
                } else if (character === ')') {
                    depth = Math.max(0, depth - 1);
                } else if (character === ',' && depth === 0) {
                    entries.push(current.trim());
                    current = '';
                    continue;
                }

                current += character;
            }
        });

        if (current.trim()) {
            entries.push(current.trim());
        }

        return entries;
    }

    /**
     * Takes the select list off the statement so the shape of the query stays readable, and keeps
     * it for the grid below. Clearing the list the collector sent separately also drops the row's
     * own toggle, which the grid replaces.
     *
     * The statement is kept as it was collected, because that is the form the recorded parameters
     * are keyed by and the form the server explains.
     */
    function expandFields(stmt) {
        // Toggling a filter re-renders the rows, and the runnable statement has to survive that:
        // what the display keeps is a placeholder standing in for the select list.
        if (stmt.statement) {
            return;
        }

        var list = typeof stmt.params === 'string' ? stmt.params : '';

        stmt.statement = fullStatement(stmt);
        // The placeholder stands in for everything between SELECT and FROM, so a DISTINCT ends up
        // in the list. It belongs with the keyword, not in a cell of its own.
        stmt.distinct = /^\s*DISTINCT\b/i.test(list);
        stmt.columns = list ? splitEntries(list.replace(/^\s*DISTINCT\b/i, '')) : null;
        stmt.sql = beautify(stmt.sql);
        stmt.params = null;
    }

    /**
     * Reused rather than allocated per entry, because a statement can carry eighty of them and a
     * page can carry hundreds of statements.
     */
    var probe = document.createElement('span');

    /**
     * The highlighter's SQL grammar only treats a quoted identifier as a string once a keyword has
     * put it in that state, so `"Member"."ClassName"` on its own comes back as plain text. Each
     * entry is highlighted as the select list it is, and the keyword is then taken off the result.
     */
    function highlightEntry(text) {
        probe.innerHTML = PhpDebugBar.Widgets.highlight('SELECT ' + text, 'sql');

        var keyword = probe.querySelector('.hljs-keyword');

        if (!keyword || keyword.textContent !== 'SELECT') {
            return probe.innerHTML;
        }

        var separator = keyword.nextSibling;

        keyword.remove();

        // The space that stood between the keyword and the entry.
        if (separator && separator.nodeType === Node.TEXT_NODE) {
            separator.textContent = separator.textContent.replace(/^ /, '');
        }

        return probe.innerHTML;
    }

    /**
     * An entry past this many characters is given a row to itself. These are the `CASE ... END AS`
     * expressions, which are several times the width of a column name and would otherwise stretch
     * one grid row far taller than the rest.
     */
    var WIDE_ENTRY = 60;

    var PLACEHOLDER = '"ClickToShowFields"';

    /**
     * Lays the select list out as a grid where the placeholder stood, rather than one entry per
     * line: a DataObject select names every column of every table in its ancestry, and eighty
     * lines of them buries the rest of the statement.
     *
     * The track count is left to `auto-fill` in the stylesheet, so nothing here has to measure
     * text or know how wide the panel is.
     */
    function gridColumns(li, stmt) {
        if (!stmt.columns) {
            return;
        }

        // highlight.js renders the placeholder as a single string token, which is why it is worth
        // keeping rather than substituting a marker of our own.
        var placeholder = jQuery(li).find('code.phpdebugbar-widgets-sql .hljs-string').filter(function () {
            return jQuery(this).text() === PLACEHOLDER;
        });

        if (!placeholder.length) {
            return;
        }

        // A span, not a div: the list sits inside a `code`, which only takes phrasing content.
        var grid = jQuery('<span class="ft-columns" />');

        var longest = 0;

        stmt.columns.forEach(function (column, index) {
            // The separator is kept on the entry so the list can still be selected and pasted as
            // SQL, which laying it out in cells would otherwise lose.
            var last = index === stmt.columns.length - 1;
            var text = last ? column : column + ',';
            var wide = column.length > WIDE_ENTRY;

            // A wide entry has a row to itself, so it does not get a say in the track width.
            if (!wide) {
                longest = Math.max(longest, text.length);
            }

            jQuery('<span />')
                .addClass(wide ? 'ft-column ft-column-wide' : 'ft-column')
                // Highlighted per entry, because the widget only highlights the statement it
                // renders and these are built afterwards.
                .html(highlightEntry(text))
                .appendTo(grid);
        });

        // The track has to hold the longest entry whole, and CSS cannot work that out on its own:
        // `auto-fill` needs a track size it can resolve up front, which rules out `max-content`.
        //
        // No text needs measuring for it either. The panel's font is monospace, so one `ch` is the
        // width of any character and the longest entry's length is its width.
        grid[0].style.setProperty('--ft-column-width', (longest + 1) + 'ch');

        if (stmt.distinct) {
            placeholder.before(jQuery('<span class="hljs-keyword" />').text('DISTINCT'), '\n');
        }

        placeholder.replaceWith(grid);
    }

    // Ranked so the worst colour wins when one cell attracts several notes.
    var COLOURS = {green: 1, yellow: 2, orange: 3, red: 4};

    /**
     * MySQL is inconsistent about the case of EXPLAIN column names, so columns are matched
     * without it.
     */
    function column(row, name) {
        return Object.keys(row).find(function (key) {
            return key.toLowerCase() === name.toLowerCase();
        });
    }

    function value(row, name) {
        var key = column(row, name);

        return key ? row[key] : null;
    }

    function display(row, name) {
        var cell = value(row, name);

        return cell === null ? 'NULL' : String(cell);
    }

    /**
     * Collects notes against the column they describe, so the cell carrying the problem is the
     * one that gets coloured. Where a column collects several notes the worst colour wins and
     * the tooltip lists them all.
     */
    function noteCollector(row) {
        var notes = {};
        var table = value(row, 'table');
        var prefix = table ? table + ': ' : '';

        return {
            notes: notes,
            add: function (name, colour, message) {
                var key = column(row, name);
                if (!key) {
                    return;
                }

                var note = notes[key] || (notes[key] = {colour: colour, messages: []});
                if (COLOURS[colour] > COLOURS[note.colour]) {
                    note.colour = colour;
                }

                note.messages.push(prefix + message);
            }
        };
    }

    /**
     * Derived and unnamed tables have no index to be missing.
     */
    function isRealTable(row) {
        var table = value(row, 'table');

        return Boolean(table) && table.indexOf('<') !== 0;
    }

    /**
     * possible_keys is NULL when the optimiser saw no candidate index. A missing key is then
     * the ALL / index scan already flagged on type.
     */
    function hasPossibleKeys(row) {
        var possible = value(row, 'possible_keys');

        return Boolean(possible) && String(possible).toUpperCase() !== 'NULL';
    }

    /**
     * An empty or non-numeric filtered cell is not an estimate. 0% is.
     */
    function hasFilteredEstimate(row) {
        return !isNaN(parseFloat(value(row, 'filtered')));
    }

    /**
     * 1003 is the optimiser's rewrite of the query, which is output rather than a problem.
     */
    function isReportedProblem(row) {
        return String(value(row, 'Code')) !== '1003' && String(value(row, 'Message') || '').trim() !== '';
    }

    /**
     * Every rule names the section and the column it applies to, so a rule only ever flags
     * cells in the one column of the one table. A rule matches when all of the conditions it
     * declares hold: `equals` and `match` against the cell's text, `min` (inclusive) and `max`
     * (exclusive) against its number, and `when` against the row as a whole. Numeric bands are
     * written so they do not overlap, leaving one note per cell. `{Column}` in a detail is
     * replaced with that column's value from the row.
     */
    var RULES = [
        {
            section: 'EXPLAIN',
            column: 'type',
            equals: 'ALL',
            when: isRealTable,
            colour: 'orange',
            detail: 'No index is used, so every row in the table is read.'
        },
        {
            section: 'EXPLAIN',
            column: 'type',
            equals: 'index',
            when: isRealTable,
            colour: 'orange',
            detail: 'The whole index is read. That avoids the table, but still visits every index entry.'
        },
        {
            section: 'EXPLAIN',
            column: 'key',
            equals: 'NULL',
            when: hasPossibleKeys,
            colour: 'orange',
            detail: 'An index in possible_keys was not used.'
        },
        {
            section: 'EXPLAIN',
            column: 'select_type',
            equals: 'DEPENDENT SUBQUERY',
            colour: 'red',
            detail: 'DEPENDENT SUBQUERY. This query re-runs for each row of the outer query.'
        },
        {
            section: 'EXPLAIN',
            column: 'select_type',
            equals: 'UNCACHEABLE SUBQUERY',
            colour: 'red',
            detail: 'UNCACHEABLE SUBQUERY. The result cannot be cached, so it re-runs for each outer row.'
        },
        {
            section: 'EXPLAIN',
            column: 'rows',
            min: 10000,
            max: 100000,
            colour: 'orange',
            detail: 'MySQL expects to examine {rows} rows.'
        },
        {
            section: 'EXPLAIN',
            column: 'rows',
            min: 100000,
            colour: 'red',
            detail: 'MySQL expects to examine {rows} rows.'
        },
        {
            section: 'EXPLAIN',
            column: 'filtered',
            when: hasFilteredEstimate,
            max: 33,
            colour: 'red',
            detail: 'Only {filtered} of the examined rows survive the WHERE clause.'
        },
        {
            section: 'EXPLAIN',
            column: 'filtered',
            min: 33,
            max: 50,
            colour: 'orange',
            detail: 'Only {filtered} of the examined rows survive the WHERE clause.'
        },
        {
            section: 'EXPLAIN',
            column: 'filtered',
            min: 50,
            max: 95,
            colour: 'yellow',
            detail: 'Only {filtered} of the examined rows survive the WHERE clause.'
        },
        {
            section: 'EXPLAIN',
            column: 'filtered',
            min: 95,
            colour: 'green',
            detail: '{filtered} of the examined rows survive the WHERE clause.'
        },
        {
            section: 'EXPLAIN',
            column: 'Extra',
            match: 'Using temporary',
            colour: 'red',
            detail: 'Using temporary. MySQL builds a temporary table to resolve the query, which is written to disk once it outgrows the memory limit.'
        },
        {
            section: 'EXPLAIN',
            column: 'Extra',
            match: 'Using filesort',
            colour: 'orange',
            detail: 'Using filesort. The rows have to be sorted after they are read because no index provides the ORDER BY order.'
        },
        {
            section: 'EXPLAIN',
            column: 'Extra',
            match: 'Full scan on NULL key',
            colour: 'orange',
            detail: 'Full scan on NULL key. A subquery falls back to a full scan when its comparison value is NULL.'
        },
        {
            section: 'EXPLAIN',
            column: 'Extra',
            match: 'Using join buffer',
            colour: 'orange',
            detail: 'Using join buffer. The join has no usable index, so rows are buffered and compared in batches.'
        },
        {
            section: 'EXPLAIN',
            column: 'Extra',
            match: 'Range checked for each record',
            colour: 'orange',
            detail: 'Range checked for each record. There is no usable join index until each outer row is known, so the range is re-planned per row.'
        },
        {
            section: 'EXPLAIN',
            column: 'Extra',
            match: 'Impossible WHERE',
            colour: 'orange',
            detail: 'Impossible WHERE. The WHERE clause can never match, so this part of the query returns nothing.'
        },
        {
            section: 'SHOW WARNINGS',
            column: 'Message',
            when: isReportedProblem,
            colour: 'orange',
            detail: 'MySQL reported this as {Level} {Code}.'
        }
    ];

    function applies(rule, row) {
        var cell = value(row, rule.column);

        if (rule.when && !rule.when(row)) {
            return false;
        }

        if (rule.equals !== undefined && String(cell).toUpperCase() !== rule.equals.toUpperCase()) {
            return false;
        }

        if (rule.match !== undefined && String(cell || '').indexOf(rule.match) === -1) {
            return false;
        }

        if (rule.min !== undefined && !(parseFloat(cell) >= rule.min)) {
            return false;
        }

        return !(rule.max !== undefined && !(parseFloat(cell) < rule.max));
    }

    function detail(rule, row) {
        return rule.detail.replace(/{(\w+)}/g, function (placeholder, name) {
            return display(row, name);
        });
    }

    function notesFor(row, section) {
        var collector = noteCollector(row);

        RULES.forEach(function (rule) {
            if (rule.section === section && applies(rule, row)) {
                collector.add(rule.column, rule.colour, detail(rule, row));
            }
        });

        return collector.notes;
    }

    /**
     * Built as elements with their text set rather than as markup, because a column name, a cell
     * value and a MySQL warning are all data, and assembling them into a string would let any
     * angle bracket among them be parsed as HTML.
     */
    function table(rows, section) {
        if (!rows.length) {
            return jQuery('<p />').text('No rows.');
        }

        var columns = Object.keys(rows[0]);
        var element = jQuery('<table class="ft-explain-table" />');
        var head = jQuery('<tr />').appendTo(jQuery('<thead />').appendTo(element));
        var body = jQuery('<tbody />').appendTo(element);

        columns.forEach(function (column) {
            jQuery('<th />').text(column).appendTo(head);
        });

        rows.forEach(function (row) {
            var notes = notesFor(row, section);
            var line = jQuery('<tr />').appendTo(body);

            columns.forEach(function (column) {
                var note = notes[column];
                var cell = jQuery('<td />')
                    .text(display(row, column))
                    .appendTo(line);

                if (note) {
                    cell
                        .addClass('ft-explain-cell-' + note.colour)
                        .attr('title', note.messages.join('\n'));
                }
            });
        });

        return element;
    }

    /**
     * The heading doubles as the section name the rules are matched against.
     */
    function section(panel, heading, rows) {
        jQuery('<h4 class="ft-explain-heading" />').text(heading).appendTo(panel);
        table(rows, heading).appendTo(panel);
    }

    function message(panel, text, className) {
        var paragraph = jQuery('<p />').text(text);

        if (className) {
            paragraph.addClass(className);
        }

        panel.empty().append(paragraph);
    }

    /**
     * Fetch and JSON failures arrive as Error, DOMException, a string, or anything else a
     * Promise rejects with. textContent would otherwise show "[object TypeError]".
     */
    function errorText(error) {
        if (typeof error === 'string' && error) {
            return error;
        }

        if (error && typeof error.message === 'string' && error.message) {
            return error.message;
        }

        if (error == null) {
            return 'Unknown error';
        }

        var text = String(error);

        if (text && text !== '[object Object]') {
            return text;
        }

        try {
            text = JSON.stringify(error);
        } catch (ignored) {
            text = '';
        }

        return text || 'Unknown error';
    }

    function render(panel, data) {
        if (data.error) {
            message(panel, data.error, 'ft-explain-error');
            return;
        }

        panel.empty();
        section(panel, 'EXPLAIN', data.explain || []);
        section(panel, 'SHOW WARNINGS', data.warnings || []);
    }

    /**
     * Every statement the collector recorded with its parameters, keyed by the statement shown
     * in the row.
     *
     * The bar keeps its instance in a local, so the data is taken as it arrives rather than read
     * back off the bar afterwards.
     */
    var recordedStatements = {};

    var addDataSet_ = PhpDebugBar.DebugBar.prototype.addDataSet;

    PhpDebugBar.DebugBar.prototype.addDataSet = function (data) {
        if (data && data[COLLECTOR]) {
            recordedStatements = data[COLLECTOR];
        }

        return addDataSet_.apply(this, arguments);
    };

    /**
     * Only the recorded statement is ever sent, so the server binds the values rather than
     * explaining the ones the collector inlined for display. The row's own SQL is never sent:
     * inlined values explain as constants where the statement that ran used placeholders.
     *
     * The session's security token goes with it, because the endpoint runs the statement and
     * would otherwise run whatever another site posted on a logged in admin's behalf.
     *
     * @return Body for the recorded statement, or null when the row has none.
     */
    function requestBody(sql) {
        var statement = recordedStatements[sql];

        if (!statement) {
            return null;
        }

        return 'sql=' + encodeURIComponent(statement.sql)
            + '&parameters=' + encodeURIComponent(statement.parameters)
            + '&SecurityID=' + encodeURIComponent(window.ftDebugBarExplainToken || '');
    }

    function explain(panel, sql) {
        var body = requestBody(sql);

        if (!body) {
            message(panel, 'This statement was not recorded, so it cannot be explained as it ran.', 'ft-explain-error');
            return;
        }

        message(panel, 'Explaining…');

        fetch(new URL('__debugbar/explain', document.baseURI), {
            method: 'POST',
            credentials: 'same-origin',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: body
        }).then(function (response) {
            return response.text().then(function (text) {
                try {
                    return JSON.parse(text);
                } catch (error) {
                    throw new Error(text || response.statusText || error.message);
                }
            });
        }).then(function (data) {
            render(panel, data);
        }).catch(function (error) {
            message(panel, errorText(error), 'ft-explain-error');
        });
    }

    /**
     * Queries the GraphQL executor ran, which are otherwise lost among the session, subsite and
     * permission queries the page load makes. The collector's source is a caller chain, and a
     * resolver's queries are called from the executor completing a field.
     */
    var GRAPHQL_SOURCE = /ReferenceExecutor|QueryHandler|GraphQL4|Resolver(->|::)/;

    function markGraphQL(li, stmt) {
        if (!GRAPHQL_SOURCE.test(stmt.source || '')) {
            return;
        }

        jQuery(li)
            .addClass('ft-graphql-statement')
            .prepend('<span class="ft-graphql-badge" title="Run by the GraphQL executor, not the page load">GraphQL</span>');
    }

    function addButton(li, stmt) {
        if (!/^\s*SELECT\b/i.test(stmt.statement || '')) {
            return;
        }

        // First in the row because the button is floated, and a float only rises as high as the
        // line it is declared on: appended, it would sit on the last line beside the row's own
        // duration, memory and source.
        var button = jQuery('<button type="button" class="ft-explain-button">EXPLAIN</button>').prependTo(li);
        var panel = jQuery('<div class="ft-explain-panel" />').hide().appendTo(li);

        button
            .on('click', function (event) {
                // The row carries click handlers of its own.
                event.stopPropagation();

                if (panel.is(':visible')) {
                    panel.hide();
                    return;
                }

                panel.show();
                explain(panel, stmt.statement);
            });
    }

    var render_ = PhpDebugBar.Widgets.SQLQueriesWidget.prototype.render;

    PhpDebugBar.Widgets.SQLQueriesWidget.prototype.render = function () {
        render_.apply(this, arguments);

        // Wrapped after the original render so the list exists, but before any data arrives.
        var itemRenderer = this.$list.get('itemRenderer');

        this.$list.set('itemRenderer', function (li, stmt) {
            expandFields(stmt);
            itemRenderer(li, stmt);
            markGraphQL(li, stmt);
            gridColumns(li, stmt);
            addButton(li, stmt);
        });
    };
})();
