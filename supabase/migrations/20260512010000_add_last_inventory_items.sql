-- Cross-execution cache for the inventory_reader_tool response.
--
-- Why: `Build Inventory Tool Response` (BIT) runs inside a toolWorkflow
-- sub-execution; its computed `items[*].quote` is not visible from the
-- parent execution where `Code in JavaScript1` builds the WhatsApp
-- finca cards. Without the cache, `_bitFincaIndex()` returns an empty
-- index → `_rehydrateFinca()` keeps the LLM's stripped finca → the
-- card falls back to "💰 desde $X / noche" without extras.
--
-- BIT writes here on every call; CodeJS1 reads it via the existing
-- `Get Context-conversations1` SELECT *.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inventory_items jsonb,
  ADD COLUMN IF NOT EXISTS last_inventory_at    timestamptz;
