"use client";

/**
 * Undo / redo over whole-UBM snapshots. Gesture pattern (matches a CAD editor):
 *   1. call `snapshot()` once at the START of an edit (mouse-down / property change),
 *   2. mutate freely via `setPresent()` during the gesture (drag) — no extra history,
 *   3. `undo()` / `redo()` walk the stacks.
 *
 * Snapshots are structural clones so history entries never alias the live document.
 */
import { useCallback, useRef, useState } from "react";
import type { UniversalBuildingModel } from "../ubm/types";

const clone = (u: UniversalBuildingModel): UniversalBuildingModel => structuredClone(u);
const LIMIT = 200;

export interface UbmHistory {
  present: UniversalBuildingModel | null;
  setPresent: React.Dispatch<React.SetStateAction<UniversalBuildingModel | null>>;
  snapshot: () => void;
  undo: () => void;
  redo: () => void;
  reset: (ubm: UniversalBuildingModel | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  depth: number;
}

export function useUbmHistory(initial: UniversalBuildingModel | null = null): UbmHistory {
  const [present, setPresent] = useState<UniversalBuildingModel | null>(initial);
  const past = useRef<UniversalBuildingModel[]>([]);
  const future = useRef<UniversalBuildingModel[]>([]);
  const [tick, setTick] = useState(0); // forces re-render when the stacks change

  const snapshot = useCallback(() => {
    setPresent((cur) => {
      if (cur) {
        past.current.push(clone(cur));
        if (past.current.length > LIMIT) past.current.shift();
        future.current = [];
      }
      return cur;
    });
    setTick((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    setPresent((cur) => {
      const prev = past.current.pop();
      if (!prev) return cur;
      if (cur) future.current.push(clone(cur));
      return prev;
    });
    setTick((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    setPresent((cur) => {
      const next = future.current.pop();
      if (!next) return cur;
      if (cur) past.current.push(clone(cur));
      return next;
    });
    setTick((n) => n + 1);
  }, []);

  const reset = useCallback((ubm: UniversalBuildingModel | null) => {
    past.current = [];
    future.current = [];
    setPresent(ubm);
    setTick((n) => n + 1);
  }, []);

  void tick;
  return {
    present,
    setPresent,
    snapshot,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    depth: past.current.length,
  };
}
