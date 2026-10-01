---
status: accepted
---

# SQL 补全照抄 pgcli 的做法，切词用 lang-sql 的语法树

**Data Source Tab** 的控制台、数据源上的配置对话框、表数据的 WHERE / ORDER BY 框都要补全 SQL（`docs/prd/database.md`「补全」「补全引擎」）。原来用的是 `@codemirror/lang-sql` 自带的补全：只按 `schema` 配置列出表名、列名和关键字，不分子句，别名只认语句顶层的 FROM，没有函数，也不知道 JOIN 该连哪张表；它的作者明确表示不做别名与上下文补全。能直接装上用的库，没有一个同时覆盖 PostgreSQL、MySQL、MariaDB、SQLite，又能处理写到一半的语句。我们决定照抄 pgcli（PostgreSQL 的命令行客户端，补全做了十多年，pgAdmin 4 用的是它的分支）的做法，自己移植成 TypeScript：

- **照搬的范围**：尽量完全照抄，按它的结构逐函数照搬——
  - 判断光标处该补什么：`packages/sqlcompletion.py`（`suggest_type`、`suggest_based_on_last_token` 等，建议类型 Column / FromClauseItem / Join / JoinCondition / Alias / Function / Keyword / Datatype 等）；
  - 取出语句里的表、别名与 CTE：`packages/parseutils/{tables,ctes,utils}.py`，连同它们依赖的 sqlparse 的语句切分、分组与语法元素；
  - 匹配与排序：`pgcompleter.py`（`find_matches` 与各 `get_*_matches`），包括 JOIN 时按外键给出要连的表和 ON 条件；
  - 内置函数、关键字与类型：pgcli 的 `pgliterals.json`。
- **按方言**：MySQL / MariaDB 照 mycli，SQLite 照 litecli。三者同源、结构相同：同一个判断点上它们与 pgcli 不同或另有分支时（如 MySQL 的枚举值、字符集、存储过程、反引号），照各自的来源；内置函数、关键字与类型也取各自自带的数据。MySQL / MariaDB 的自定义函数补全只插入函数名（照 mycli），不插 pgcli 为 PostgreSQL 写的 `参数 := ` 具名参数——在 MySQL 里 `:=` 是赋值。
- **另借两处 pgcli 没有的**：子查询的作用域参照 sqls（Go 写的 SQL 语言服务器）的 `parser/parseutil`：pgcli 不分作用域，FROM 里子查询的表会带到外层，WHERE 里子查询的表又取不到。关键字按子句过滤参照 Tabularis 的 `KEYWORD_ALLOWED_CLAUSES`：pgcli 给关键字时只看前一个关键字（挑常见的后续），不管光标在哪个子句，mycli / litecli 连这一步也没有。
- **补上 pgcli 关键字表漏掉的**：它的补全关键字表漏了一批写查询常用的（如 `ILIKE`、`OFFSET`、`RETURNING`、`END`），从它自己的保留字表里补上（`PG_MISSING_KEYWORDS`）。
- **照搬部分唯一换掉的是切词**：pgcli 用 Python 的 sqlparse 切词，我们用编辑器现成的 lang-sql 语法树——一个适配层把语法树的叶子转成与 sqlparse 等价的记号流（类别查 sqlparse 的关键字表，按位置的判定照 sqlparse 的规则），再交给照搬的切分与分组。这样不引入第二套解析器，引号、注释、字符串的认法与编辑器的高亮一致。这一层里有两处有意与 sqlparse 不同：sqlparse 表里的关键字（`type`、`key`、`data` 等）在本方言里不是保留字时，在只能是名字的位置（表名与别名、`AS` 之后、选择列表里的一项）纠正为名字，否则叫这些名字的表和列补不出来；MySQL / MariaDB 的可执行注释（`/*! … */`、`/*!50003 … */`）照 mysql 客户端当代码，里面照常切词、只有开头与结尾另记，否则 mysqldump 写在里面的语句执行前就被当注释丢掉（sqlparse 与 lang-sql 都当注释，编辑器里仍按注释高亮）。lang-sql 自己的切法与服务器不符的（MySQL 的 `--` 注释只认后跟空格，单独一行的 `--` 认不出；可执行注释遇到第一个 `*/` 就算结尾，字符串里的也算）用 pnpm patch 修在 lang-sql 里，高亮随之一致。
- **接入**：一个引擎给三处共用。编辑器的语言改为 lang-sql 的方言语言配上这个补全源（`new LanguageSupport(language, [language.data.of({ autocomplete })])`），不再用 `sql()`：它不论给不给 schema 都会挂上自带的关键字补全。补全只取光标所在的那条语句、在内存里匹配；排序与筛选全照 pgcli，不用 CodeMirror 自己的筛选。WHERE / ORDER BY 框改成单行编辑器，补全时在框里的文字前面接上 `SELECT * FROM 这张表 WHERE `（或 `ORDER BY `），上下文就固定为这张表和这个子句。补全要的表结构扩充为列的类型与默认值、库里的自定义函数与类型、外键，MySQL / MariaDB 另有字符集、排序规则、`SHOW` 的各项与用户（读不出来即没有那一项的候选，同 mycli），主进程照 pgcli / mycli / litecli 读表结构的查询来读，存进表结构缓存（ADR-0045）。
- **使用次数照 pgcli，但按数据源存盘**：pgcli 按执行过的语句里各个名字与关键字出现的次数排序（`packages/prioritization.py`），照搬。pgcli 的次数只在内存里（启动时只从命令历史补回关键字），我们按数据源存盘、跨重启保留：这个数据源的控制台、WHERE / ORDER BY 框与运行配置对话框共用一份，只数控制台与运行配置里执行成功的语句。关键字的次数按关键字表的写法（大写）记，查的时候也换成大写；pgcli 按候选原样查，关键字补成小写时（mycli / litecli 随输入的大小写）就查不到，这一处有意与 pgcli 不同。
- **不吸收 mycli / litecli 独有的功能**：只在同一个判断点上照它们，pgcli 没有的功能不加，匹配与排序各方言都照 pgcli。不吸收的有：
  - 输入以反引号开头时给所有候选都加反引号：函数候选带参数表、JOIN 候选是整条连接子句，整个包上反引号就成了错的 SQL；
  - 语句里还没有表时列出 `USE` 选的那个库里所有表的全部列：表多时上万条；
  - 每张表的 `*` 列、按已输入的列给表排序、JOIN 时把有外键的表排前（pgcli 另给一条带 ON 条件的 JOIN 候选，排在各表之前）、索引列的样式；
  - mycli 自己的模糊匹配与排序规则（限定间距、按下划线与驼峰拆词、按最近使用排序等）。
- **测试翻译为验收标准**：pgcli、mycli、litecli 的补全测试翻译成 vitest，用例与期望值照原样。改动与没翻译的逐条在用例旁写明原因：命令行专用的（反斜杠命令、命名查询、`\i` 路径）不翻译；pgcli 标为已知失败（xfail）而本引擎能过的（如借 sqls 的作用域修好的子查询用例），改为正常断言；期望的关键字列表同样按子句过滤；mycli / litecli 与 pgcli 排序、匹配规则不同的用例，只比集合或两边都认出的部分。切词适配层另有对照用例，期望值由 sqlparse 对同样的文字切出。

## Considered Options

- **沿用 lang-sql 自带的补全**：不用写，但做不到上下文。作者也说它的解析器不够精确，做不了按上下文补全。
- **@marimo-team/codemirror-sql**：能直接接进 CodeMirror，靠 node-sql-parser 解析，四种数据库都能用；但子句只靠正则判断，子查询的表混在一起，没有函数，写到一半的语句解析失败就退回正则。
- **dt-sql-parser / @gravity-ui/websql-autocomplete**：上下文能力强（子句、别名、子查询、JOIN、INSERT 的列）；但没有 SQLite，MariaDB 借用 MySQL 的语法，每种方言 2–4 MB，还要放进 Worker。
- **sql-language-server 的新引擎**：设计上合适（只解析到光标处、带 CTE 的列），但调研时刚重写、还没发到 npm，窗口函数、`ON CONFLICT`、`$$` 函数体等语法缺失。
- **postgres-language-server**（Supabase）：按子句打分，质量高，但只支持 PostgreSQL，WASM 12 MB。
- **严格的 SQL 解析器**（node-sql-parser、sqlparser-rs 的 WASM 等）：写到一半的语句一律报错；node-sql-parser 的作者也明确不做补全。
- **整套照抄 sqls 或 Tabularis**：sqls 的子查询作用域完整，但没有 CTE；Tabularis 分子句细，但只管关键字。各取一块，主体照 pgcli。
- **切词也照抄 sqlparse**：与 pgcli 完全一致，但编辑器里就有两套各自认引号、注释、字符串的解析器，高亮与补全可能对同一段文字认得不一样。

## Consequences

- 补全引擎归我们维护，约五千多行，外加翻译过来的测试；pgcli、mycli、litecli 以后修的问题、加的功能要自己对照移植。
- 切词的适配层是最容易出意外的地方：lang-sql 与 sqlparse 对同一段文字切法不同时（如 lang-sql 的 MySQL 方言没有 `/`、`~` 这两个运算符字符，SQLite 方言把单独的 `:` 当变量），要在适配层按 sqlparse 纠正，并补对照用例。
- 与 WebStorm 相比整体仍有差距（它背后是完整的语义分析），日常最常用的——按子句补表或列、别名、CTE、JOIN 与 ON 条件、函数、类型——接近；补全数据都在内存里，表结构显示时就核对（ADR-0045）。
- 补全要的表结构多了几条查询（函数、外键等），连上后后台读主体结构稍慢。
- 执行过的语句里的名字（表名、列名、别名等）连同次数按数据源留在本机，改连接信息也不删，移除数据源时才删掉；控制台与运行配置每次执行有语句成功，都多一次计数与整份存回。
- 语法树还没解析完时（刚载入很长的文字）补全先再解析一小会儿，仍没解析完这次就不补全，免得把一大段文字交给引擎卡住界面。
- 执行前切语句（控制台与运行配置）也用这套切词与照搬的 sqlparse 切分，同 pgcli / mycli / litecli 执行前的 `sqlparse.split`：建过程、函数、触发器时 BEGIN … END 块里的分号不切开；sqlparse 不认的 `REPEAT … END REPEAT` 同样不认。MySQL / MariaDB 的 `DELIMITER` 照 mycli（`DelimiterCommand`）在这套切分之外处理：换了分隔符后先换掉原文的分号、把分隔符换成分号，再交给同一套切分。
- Redis 控制台的命令名补全不走这个引擎，只按服务器的命令表补行首的命令名。
