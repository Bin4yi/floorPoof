"""Probe Relate features needed by the checks."""
import relate

conn = relate.connect(":memory:")


def q(c, p=None):
    cur = conn.cursor()
    try:
        cur.execute(c, p or {})
        return cur.fetchall()
    except Exception as e:  # noqa: BLE001
        return f"ERROR {type(e).__name__}: {e}"


q("UNWIND range(0,3) AS x CREATE (:Cell {x:x, y:0, walkable:true})")
q("MATCH (a:Cell), (b:Cell) WHERE b.x = a.x + 1 CREATE (a)-[:ADJACENT]->(b), (b)-[:ADJACENT]->(a), (a)-[:NEIGHBOR]->(b)")
q("MATCH (c:Cell {x:3}) CREATE (:Exit {name:'E'})-[:AT]->(c)")
print("s = t:", q("MATCH (s:Cell {x:3}), (:Exit)-[:AT]->(t) OPTIONAL MATCH p = shortestPath((s)-[:ADJACENT*0..]->(t)) RETURN length(p) AS L"))
print("s = t (*):", q("MATCH (s:Cell {x:3}), (:Exit)-[:AT]->(t) OPTIONAL MATCH p = shortestPath((s)-[:ADJACENT*]->(t)) RETURN length(p) AS L"))
print("directed sp:", q("MATCH (s:Cell {x:0}), (:Exit)-[:AT]->(t) MATCH p = shortestPath((s)-[:ADJACENT*]->(t)) RETURN length(p) AS L, [n IN nodes(p) | [n.x, n.y]] AS cells"))
print("EXISTS:", q("MATCH (c:Cell) RETURN c.x AS x, EXISTS { (c)<-[:AT]-(:Exit) } AS isExit ORDER BY x"))
print("list prop:", q("CREATE (n:T {cells:[1,2,3], s:'[[1,2]]'}) RETURN n.cells AS c, n.s AS s"))
print("nested list prop:", q("CREATE (n:T2 {cells:[[1,2],[3,4]]}) RETURN n.cells AS c"))
print("MERGE rel:", q("MATCH (a:Cell {x:0}), (b:Cell {x:1}) MERGE (a)-[:ADJACENT]->(b) RETURN count(*) AS n"))
print("undirected NEIGHBOR:", q("MATCH (c:Cell {x:1})-[:NEIGHBOR]-(n) RETURN collect(n.x) AS ns"))
print("sqrt/abs/ceil:", q("RETURN sqrt(16) AS s, abs(-2) AS a, ceil(1.2) AS c, toInteger(2.7) AS i"))
print("float param:", q("RETURN $f * 2 AS v", {"f": 0.5}))
print("map param:", q("UNWIND $rows AS r RETURN r.a AS a, r.b[1] AS b1", {"rows": [{"a": 1, "b": [5, 6]}]}))
print("COLLECT subquery:", q("MATCH (c:Cell {x:1}) RETURN COLLECT { MATCH (c)-[:NEIGHBOR]-(n) RETURN n.x } AS ns"))
print("CALL subquery:", q("MATCH (c:Cell) CALL (c) { MATCH (c)-[:NEIGHBOR]-(n) RETURN count(n) AS k } RETURN c.x AS x, k ORDER BY x"))
print("ANY SHORTEST unbound end:", q("MATCH p = ANY SHORTEST (s:Cell {x:0})-[:ADJACENT]->+(t:Cell WHERE EXISTS {(t)<-[:AT]-(:Exit)}) RETURN length(p) AS L"))

# Txn: delete rels, check path, rollback
conn.autocommit = False
print("txn delete:", q("MATCH (c:Cell {x:2})-[r:ADJACENT]-() DELETE r SET c.walkable = false RETURN count(r) AS n"))
print("txn path after delete:", q("MATCH (s:Cell {x:0}), (:Exit)-[:AT]->(t) OPTIONAL MATCH p = shortestPath((s)-[:ADJACENT*]->(t)) RETURN length(p) AS L"))
print("bad stmt in txn:", q("MATCH (n) RETURN n.x / 'a' AS z"))
conn.rollback()
conn.autocommit = True
print("after rollback:", q("MATCH (s:Cell {x:0}), (:Exit)-[:AT]->(t) OPTIONAL MATCH p = shortestPath((s)-[:ADJACENT*]->(t)) RETURN length(p) AS L"))
print("walkable restored:", q("MATCH (c:Cell {x:2}) RETURN c.walkable AS w"))
print("version:", q("CALL dbms.components() YIELD name, versions RETURN name, versions"))
