"""Find the smallest statement sequence that panics Relate 1.0.1."""
import relate


def attempt(label, stmts, txn=True):
    conn = relate.connect(":memory:")
    cur = conn.cursor()
    cur.execute("CREATE (:C {k:1}), (:C {k:2})", {})
    if txn:
        conn.autocommit = False
    try:
        for s in stmts:
            cur.execute(s, {})
            cur.fetchall()
        print(f"{label}: ok")
    except BaseException as e:  # PanicException is a BaseException
        print(f"{label}: {type(e).__name__}: {str(e)[:90]}")
    finally:
        try:
            conn.rollback()
        except BaseException:
            pass


MK = "MATCH (a:C {k:1}), (b:C {k:2}) CREATE (a)-[:R]->(b)"
DEL = "MATCH (:C)-[r:R]->() DELETE r"
MERGE = "MATCH (a:C {k:1}), (b:C {k:2}) MERGE (a)-[:R]->(b)"
NODE = "CREATE (:X {id:1})"
DELNODE = "MATCH (x:X) DETACH DELETE x"
SETP = "MATCH (c:C) SET c.w = false"

attempt("create rel then delete it (txn)", [MK, DEL])
attempt("create rel then delete it (autocommit)", [MK, DEL], txn=False)
attempt("create node then detach delete (txn)", [NODE, DELNODE])
attempt("create node+rel then detach delete (txn)", [NODE, "MATCH (x:X), (c:C {k:1}) CREATE (x)-[:O]->(c)", DELNODE])
attempt("set prop twice (txn)", [SETP, SETP])
attempt("merge after delete (txn)", [MK, DEL, MERGE])
attempt("delete pre-existing then create (txn)", ["MATCH (a:C {k:1}), (b:C {k:2}) CREATE (a)-[:Q]->(b)"], txn=False)
