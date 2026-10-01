import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { allStatements, statementsToRun } from './sql-statements'

/** doc 里的 | 是光标；[ ] 是选区。 */
function stateOf(marked: string): EditorState {
  const cursor = marked.indexOf('|')
  const start = marked.indexOf('[')
  if (cursor >= 0) {
    return EditorState.create({
      doc: marked.replace('|', ''),
      selection: EditorSelection.cursor(cursor)
    })
  }
  const doc = marked.replace('[', '').replace(']', '')
  const end = marked.indexOf(']') - 1
  return EditorState.create({ doc, selection: EditorSelection.range(start, end) })
}

describe('statementsToRun', () => {
  const script = "select 1;\n-- 注释\nselect * from t where a = 'x;y';\n\nupdate t set a = 1"

  it('光标所在的那条；字符串里的分号不切', () => {
    const at = script.indexOf('from t')
    expect(
      statementsToRun(stateOf(`${script.slice(0, at)}|${script.slice(at)}`), 'postgresql')
    ).toEqual(["select * from t where a = 'x;y'"])
  })

  it('光标在两条之间取上面那条；最前面取下面那条', () => {
    const blank = script.indexOf('\n\nupdate') + 1
    expect(
      statementsToRun(stateOf(`${script.slice(0, blank)}|${script.slice(blank)}`), 'postgresql')
    ).toEqual(["select * from t where a = 'x;y'"])
    expect(statementsToRun(stateOf(`|  ${script}`), 'postgresql')).toEqual(['select 1'])
  })

  it('光标在注释里取上面那条', () => {
    const at = script.indexOf('注释')
    expect(
      statementsToRun(stateOf(`${script.slice(0, at)}|${script.slice(at)}`), 'postgresql')
    ).toEqual(['select 1'])
  })

  it('光标在 MySQL 的可执行注释里取这一条', () => {
    expect(
      statementsToRun(stateOf('select 1;\n/*!40101 SET |NAMES utf8mb4 */;\nselect 2'), 'mysql')
    ).toEqual(['/*!40101 SET NAMES utf8mb4 */'])
  })

  it('没有分号结尾的最后一条也算', () => {
    expect(statementsToRun(stateOf(`${script}|`), 'postgresql')).toEqual(['update t set a = 1'])
  })

  it('有选区时执行选中的各条', () => {
    expect(
      statementsToRun(
        stateOf("[select 1;\n-- 注释\nselect * from t where a = 'x;y';]"),
        'postgresql'
      )
    ).toEqual(['select 1', "select * from t where a = 'x;y'"])
  })

  it('什么都没有时为空', () => {
    expect(statementsToRun(stateOf('|  -- 只有注释'), 'postgresql')).toEqual([])
  })

  it('光标在过程体里时整个 CREATE PROCEDURE 是一条', () => {
    const create = 'create procedure p() begin select 1; select 2; end'
    const at = create.indexOf('select 2')
    expect(
      statementsToRun(stateOf(`${create.slice(0, at)}|${create.slice(at)};\nselect 3`), 'mysql')
    ).toEqual([create])
  })
})

describe('allStatements', () => {
  it('切出全部语句；字符串与注释里的分号不切', () => {
    expect(
      allStatements(
        "select 1;\n-- 注释; 不切\nselect * from t where a = 'x;y';\n/* ; */ update t set a = 1;",
        'postgresql'
      )
    ).toEqual(['select 1', "select * from t where a = 'x;y'", 'update t set a = 1'])
  })

  it('最后一条没有分号也算', () => {
    expect(allStatements('select 1;\nselect 2', 'postgresql')).toEqual(['select 1', 'select 2'])
  })

  it('只有注释、空白与分号时为空', () => {
    expect(allStatements('  -- 只有注释\n/* 块注释 */ ;\n', 'postgresql')).toEqual([])
  })

  it('PostgreSQL 的 $$ 函数体不切开', () => {
    const create =
      'create function f() returns int as $$ begin; select 1; return 1; end $$ language plpgsql'
    expect(allStatements(`${create};\nselect f();`, 'postgresql')).toEqual([create, 'select f()'])
  })

  it('PostgreSQL 的 BEGIN ATOMIC 函数体不切开', () => {
    const create =
      'create function f() returns int language sql begin atomic select 1; select 2; end'
    expect(allStatements(`${create};\nselect f();`, 'postgresql')).toEqual([create, 'select f()'])
  })

  it('MySQL / MariaDB 的字符串里反斜杠转义引号', () => {
    const first =
      "select count(*) from customers where note = 'C:\\\\Users\\\\test' or name like '%\\'%'"
    expect(allStatements(`${first}; select 2`, 'mysql')).toEqual([first, 'select 2'])
    expect(allStatements("select '\\';' ; select 2", 'mariadb')).toEqual([
      "select '\\';'",
      'select 2'
    ])
  })

  it('MySQL / MariaDB 的 -- 之后是空白或已到末尾才是注释：mysqldump 单独一行的 -- 不算语句', () => {
    const script =
      '--\n-- Table structure\n--\n\nDROP TABLE t;\n--\nselect 1 --\t注释\n;select 1--1; --'
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(allStatements(script, kind)).toEqual(['DROP TABLE t', 'select 1', 'select 1--1'])
    }
  })

  it('MySQL / MariaDB 的可执行注释是代码：连同注释整条发出，只有它的一条也算', () => {
    const header = '/*!40101 SET NAMES utf8mb4 */'
    const partition = 'CREATE TABLE t (a int) /*!50100 PARTITION BY HASH (a) */'
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(allStatements(`${header};\n${partition};\n/* 普通注释 */;`, kind)).toEqual([
        header,
        partition
      ])
    }
    expect(allStatements('/*M!100616 SET NOTE_VERBOSITY=0 */;', 'mariadb')).toEqual([
      '/*M!100616 SET NOTE_VERBOSITY=0 */'
    ])
    expect(allStatements('/*M!100616 SET NOTE_VERBOSITY=0 */;', 'mysql')).toEqual([])
    expect(allStatements(`${header};`, 'postgresql')).toEqual([])
  })

  it('可执行注释里照常切（同 mysql 客户端）', () => {
    expect(allStatements('/*!40101 SET a = 1; SET b = 2 */', 'mysql')).toEqual([
      '/*!40101 SET a = 1',
      'SET b = 2 */'
    ])
  })

  it('可执行注释的结尾照 mysql 客户端：字符串、带引号的名字与注释里的 */ 不算', () => {
    const select = "/*!40101 select '*/' as y */"
    const view = '/*!50001 VIEW `v*/` AS select "*/" AS `x` -- */\n*/'
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(
        allStatements(`select 'a' as x;\n${select};\n${view};\nselect 'b' as z;`, kind)
      ).toEqual(["select 'a' as x", select, view, "select 'b' as z"])
    }
    expect(allStatements("/*M!100616 select '*/' */; select 2", 'mariadb')).toEqual([
      "/*M!100616 select '*/' */",
      'select 2'
    ])
  })

  it('PostgreSQL 与 SQLite 的反斜杠不是转义符', () => {
    expect(allStatements("select 'a\\'; select 2", 'postgresql')).toEqual([
      "select 'a\\'",
      'select 2'
    ])
    expect(allStatements("select 'a\\'; select 2", 'sqlite')).toEqual(["select 'a\\'", 'select 2'])
  })

  it('MySQL / MariaDB 建过程、函数、触发器、事件时 BEGIN … END 块不切开', () => {
    const procedure = 'create procedure p() begin select 1; select 2; end'
    const fn =
      'create definer = current_user function f(a int) returns int deterministic begin declare x int default 0; if a > 0 then set x = a; end if; return x; end'
    const trigger =
      'create trigger t before insert on o for each row begin case when new.a is null then set new.a = 0; else set new.b = 1; end case; end'
    const event =
      'create event e on schedule every 1 day do begin delete from a; delete from b; end'
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(
        allStatements(`${procedure};\n${fn};\n${trigger};\n${event};\nselect 1`, kind)
      ).toEqual([procedure, fn, trigger, event, 'select 1'])
    }
  })

  it('过程体里的循环与带标签的块', () => {
    const procedure =
      'create procedure p() begin declare i int default 0; l: loop set i = i + 1; if i > 3 then leave l; end if; end loop l; while i > 0 do set i = i - 1; end while; end'
    expect(allStatements(`${procedure};\nselect 1`, 'mysql')).toEqual([procedure, 'select 1'])
  })

  it('SQLite 的触发器不切开', () => {
    const trigger =
      'create trigger t after insert on a begin insert into b values (new.id); update c set n = n + 1; end'
    expect(allStatements(`${trigger};\nselect 1`, 'sqlite')).toEqual([trigger, 'select 1'])
  })

  it('开事务的 BEGIN 与 CASE 表达式照常切', () => {
    expect(
      allStatements(
        'begin; insert into t values (1); commit; select case when a then 1 else 2 end from t; select 2',
        'mysql'
      )
    ).toEqual([
      'begin',
      'insert into t values (1)',
      'commit',
      'select case when a then 1 else 2 end from t',
      'select 2'
    ])
    expect(allStatements('begin transaction; select 1; end; select 2', 'sqlite')).toEqual([
      'begin transaction',
      'select 1',
      'end',
      'select 2'
    ])
    expect(allStatements('begin; select 1; commit', 'postgresql')).toEqual([
      'begin',
      'select 1',
      'commit'
    ])
  })
})

describe('DELIMITER（MySQL / MariaDB）', () => {
  const procedure = 'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END'
  const script = `DELIMITER $$\n${procedure}$$\nDELIMITER ;\nSELECT 3;`

  it('换上的分隔符切开各条，命令本身不发出；换回分号后照常切', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(allStatements(script, kind)).toEqual([procedure, 'SELECT 3'])
    }
  })

  it('mysqldump 的写法：分隔符为 ;;，END 与分隔符之间有空格', () => {
    const create = 'CREATE DEFINER=`root`@`%` PROCEDURE `p`()\nBEGIN\n  SELECT 1;\nEND'
    expect(allStatements(`DELIMITER ;;\n${create} ;;\nDELIMITER ;\n`, 'mysql')).toEqual([create])
  })

  it('mysqldump 写在可执行注释里的触发器与事件整条发出', () => {
    const trigger =
      '/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `t` AFTER UPDATE ON `o` FOR EACH ROW BEGIN\n  IF OLD.a <> NEW.a THEN\n    INSERT INTO log VALUES (NOW());\n  END IF;\nEND */'
    const event =
      "/*!50106 CREATE*/ /*!50117 DEFINER=`root`@`localhost`*/ /*!50106 EVENT `e` ON SCHEDULE EVERY 1 DAY STARTS '2026-09-29 13:19:14' ON COMPLETION NOT PRESERVE ENABLE DO DELETE FROM log WHERE at < NOW() - INTERVAL 90 DAY */"
    const setMode = "/*!50003 SET sql_mode = 'NO_ENGINE_SUBSTITUTION' */"
    const script = `${setMode} ;\nDELIMITER ;;\n${trigger};;\n${setMode} ;;\n${event} ;;\nDELIMITER ;\n/*!50003 SET sql_mode = @saved_sql_mode */ ;\n`
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(allStatements(script, kind)).toEqual([
        setMode,
        trigger,
        setMode,
        event,
        '/*!50003 SET sql_mode = @saved_sql_mode */'
      ])
    }
  })

  it('不分大小写；分隔符为命令之后第一段不含空白的文字，同一行里的其余照常切', () => {
    expect(allStatements('delimiter //  select 1// select 2//', 'mysql')).toEqual([
      'select 1',
      'select 2'
    ])
  })

  it('过程体里 END; 之后另起一行的 IF 不与 END 连成 END IF', () => {
    const create =
      'CREATE PROCEDURE p() BEGIN BEGIN SELECT 1; END;\nIF a THEN SELECT 2; END IF; END'
    expect(allStatements(`DELIMITER //\n${create}//\nSELECT 3//`, 'mysql')).toEqual([
      create,
      'SELECT 3'
    ])
  })

  it('过程体里的 REPEAT … END REPEAT 不再在块里的分号处切开', () => {
    const create =
      'CREATE PROCEDURE p() BEGIN DECLARE i INT DEFAULT 0; REPEAT SET i = i + 1; UNTIL i > 3 END REPEAT; END'
    expect(allStatements(`DELIMITER $$\n${create}$$\nDELIMITER ;\nSELECT 1`, 'mysql')).toEqual([
      create,
      'SELECT 1'
    ])
  })

  it('字符串里的分隔符不切；语句首尾的分号与只有分号的不算', () => {
    expect(allStatements("DELIMITER $$\n;select '$$';$$ ; $$\nselect 2$$", 'mysql')).toEqual([
      "select '$$'",
      'select 2'
    ])
  })

  it('没写分隔符、分隔符写在下一行、写成 delimiter 的不是命令，照常作为语句发出', () => {
    expect(allStatements('DELIMITER\n$$ select 1', 'mysql')).toEqual(['DELIMITER\n$$ select 1'])
    expect(allStatements('delimiter delimiter\nselect 1;', 'mysql')).toEqual([
      'delimiter delimiter\nselect 1'
    ])
  })

  it('PostgreSQL 与 SQLite 不认', () => {
    expect(allStatements('DELIMITER //\nselect 1//', 'sqlite')).toEqual([
      'DELIMITER //\nselect 1//'
    ])
  })

  it('分隔符只在这次执行的文字里有效：选中的部分从分号切起', () => {
    const doc = `DELIMITER $$\n[select 1; select 2$$]`
    expect(statementsToRun(stateOf(doc), 'mysql')).toEqual(['select 1', 'select 2$$'])
  })

  it('光标所在的那条按整段文字里的 DELIMITER 切；光标紧跟在分隔符之后仍算这一条', () => {
    const at = (marker: string, offset = 0): string => {
      const i = script.indexOf(marker) + offset
      return `${script.slice(0, i)}|${script.slice(i)}`
    }
    expect(statementsToRun(stateOf(at('SELECT 2')), 'mysql')).toEqual([procedure])
    expect(statementsToRun(stateOf(at('$$\nDELIMITER ;', 2)), 'mysql')).toEqual([procedure])
    expect(statementsToRun(stateOf(at('SELECT 3')), 'mysql')).toEqual(['SELECT 3'])
    expect(statementsToRun(stateOf(at('DELIMITER $$')), 'mysql')).toEqual([procedure])
  })
})
