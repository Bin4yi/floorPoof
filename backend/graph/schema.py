"""Indexes for the FloorProof graph.

Every floor-bound node carries a `floor` property, so one store can hold
several floors (factory and warehouse) in one graph.

Nodes: Floor, Cell, Exit, Item, ItemType, PowerPanel, Line, Zone, RulePack,
Rule, Proposal, CheckResult.

Links:
  (Floor)-[:USES_PACK]->(RulePack)
  (Cell)-[:NEIGHBOR]->(Cell)          static grid structure (right and down)
  (Cell)-[:ADJACENT]->(Cell)          walkable neighbours, both directions,
                                      kept in sync as items move
  (Cell)-[:IN_ZONE]->(Zone)
  (Exit)-[:AT]->(Cell), (PowerPanel)-[:AT]->(Cell)
  (Item)-[:OCCUPIES]->(Cell), (Item)-[:WORKS_AT]->(Cell)
  (Item)-[:IS_A]->(ItemType), (Item)-[:POWERED_BY]->(PowerPanel)
  (Item)-[:IN_LINE {seq}]->(Line), (Item)-[:FEEDS]->(Item)
  (PowerPanel)-[:FED_BY]->(PowerPanel)
  (ItemType)-[:MUST_BE_FAR_FROM {min_m}]->(ItemType)
  (RulePack)-[:HAS_RULE]->(Rule), (Rule)-[:APPLIES_TO]->(ItemType)
  (Proposal)-[:PLACES]->(Item), (Proposal)-[:HAS_RESULT]->(CheckResult)
  (CheckResult)-[:FOR_RULE]->(Rule), (CheckResult)-[:FAILED_AT]->(Cell)
"""
from .db import Graph

INDEXES = [
    "CREATE INDEX cell_floor_xy IF NOT EXISTS FOR (c:Cell) ON (c.floor, c.x, c.y)",
    "CREATE INDEX item_id IF NOT EXISTS FOR (i:Item) ON (i.id)",
    "CREATE INDEX item_floor IF NOT EXISTS FOR (i:Item) ON (i.floor)",
    "CREATE INDEX floor_name IF NOT EXISTS FOR (f:Floor) ON (f.name)",
    "CREATE INDEX exit_floor IF NOT EXISTS FOR (e:Exit) ON (e.floor)",
    "CREATE INDEX panel_floor_name IF NOT EXISTS FOR (p:PowerPanel) ON (p.floor, p.name)",
    "CREATE INDEX line_floor_name IF NOT EXISTS FOR (l:Line) ON (l.floor, l.name)",
    "CREATE INDEX type_pack_name IF NOT EXISTS FOR (t:ItemType) ON (t.pack, t.name)",
    "CREATE INDEX rule_id IF NOT EXISTS FOR (r:Rule) ON (r.id)",
    "CREATE INDEX proposal_id IF NOT EXISTS FOR (p:Proposal) ON (p.id)",
]


def create_indexes(g: Graph) -> None:
    for stmt in INDEXES:
        g.q(stmt)
