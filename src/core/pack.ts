import { fail, packSchema, type Pack, type Question } from '../contracts/index.js';
export function validatePack(input: unknown): Pack {
  const pack = packSchema.parse(input);
  if (new TextEncoder().encode(JSON.stringify(pack)).length > 384000)
    fail('PACK_TOO_LARGE', '学习包最多 384,000 字节');
  for (const [label, items] of [
    ['知识点', pack.topics],
    ['材料', pack.materials],
    ['题目', pack.questions],
    ['蓝图', pack.blueprints],
  ] as const)
    if (new Set(items.map((v) => v.id)).size !== items.length)
      fail('INVALID_PACK', `${label} ID 重复`);
  const topics = new Set(pack.topics.map((v) => v.id));
  const materials = new Map(pack.materials.map((m) => [m.id, m]));
  const visited = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    if (path.has(id)) fail('INVALID_PACK', '知识点依赖存在环');
    if (visited.has(id)) return;
    const t = pack.topics.find((t) => t.id === id);
    if (!t) fail('INVALID_PACK', `未知前置知识点 ${id}`);
    for (const p of t.prerequisites) visit(p, new Set([...path, id]));
    visited.add(id);
  };
  pack.topics.forEach((t) => visit(t.id, new Set()));
  for (const q of pack.questions) validateQuestionReferences(q, topics, materials);
  for (const b of pack.blueprints) {
    if (b.sections.reduce((n, s) => n + s.count, 0) > 30)
      fail('INVALID_PACK', '一份蓝图最多 30 题');
    for (const section of b.sections)
      if (section.topic_ids.some((t) => !topics.has(t))) fail('INVALID_PACK', '蓝图引用未知知识点');
    selectBlueprint(pack, b.id);
  }
  return pack;
}
export function validateQuestionReferences(
  q: Question,
  topics: Set<string>,
  materials: Map<string, Pack['materials'][number]>,
) {
  if (q.topic_ids.some((t) => !topics.has(t)))
    fail('INVALID_REFERENCE', `题目 ${q.id} 引用未知知识点`);
  for (const ref of q.material_refs) {
    const m = materials.get(ref.material_id);
    if (!m) fail('INVALID_REFERENCE', `题目 ${q.id} 引用未知材料`);
    if (
      ref.heading &&
      !m.content.split('\n').some((l) => l.replace(/^#+\s*/, '').trim() === ref.heading)
    )
      fail('INVALID_REFERENCE', `题目 ${q.id} 材料标题不存在：${ref.heading}`);
  }
}
export function selectBlueprint(pack: Pack, id: string): Question[] {
  const blueprint = pack.blueprints.find((b) => b.id === id);
  if (!blueprint) fail('NOT_FOUND', `蓝图不存在：${id}`, 404);
  const chosen: Question[] = [];
  for (const section of blueprint.sections) {
    const candidates = pack.questions.filter(
      (q) =>
        q.type === section.type &&
        q.points === section.points &&
        q.topic_ids.some((t) => section.topic_ids.includes(t)) &&
        !chosen.some((c) => c.id === q.id),
    );
    const covered = new Set<string>();
    let picked: Question[] = [];
    while (picked.length < section.count) {
      const ranked = candidates
        .filter((q) => !picked.includes(q))
        .sort(
          (a, b) =>
            b.topic_ids.filter((t) => section.topic_ids.includes(t) && !covered.has(t)).length -
              a.topic_ids.filter((t) => section.topic_ids.includes(t) && !covered.has(t)).length ||
            a.id.localeCompare(b.id),
        );
      if (!ranked[0]) fail('INVALID_BLUEPRINT', `蓝图 ${id} 可用题目不足`);
      picked.push(ranked[0]);
      ranked[0].topic_ids.forEach((t) => covered.add(t));
    }
    if (section.topic_ids.some((t) => !covered.has(t))) {
      // Greedy coverage can miss a valid combination. Search bounded alternatives before rejecting.
      let visits = 0;
      const seen = new Set<string>();
      const search = (selected: Question[], coverage: Set<string>): Question[] | undefined => {
        if (++visits > 20000)
          fail('BLUEPRINT_TOO_COMPLEX', `蓝图 ${id} 选题搜索超出限制，请简化重叠的知识点约束`);
        const uncovered = section.topic_ids.filter((t) => !coverage.has(t));
        if (!uncovered.length) return selected;
        if (selected.length >= section.count) return undefined;
        const stateKey = selected
          .map((q) => q.id)
          .sort()
          .join('|');
        if (seen.has(stateKey)) return undefined;
        seen.add(stateKey);
        const available = candidates.filter((q) => !selected.includes(q));
        const target = uncovered.sort(
          (a, b) =>
            available.filter((q) => q.topic_ids.includes(a)).length -
            available.filter((q) => q.topic_ids.includes(b)).length,
        )[0];
        const choices = available
          .filter((q) => q.topic_ids.includes(target))
          .sort(
            (a, b) =>
              b.topic_ids.filter((t) => !coverage.has(t)).length -
                a.topic_ids.filter((t) => !coverage.has(t)).length || a.id.localeCompare(b.id),
          );
        for (const q of choices) {
          const found = search([...selected, q], new Set([...coverage, ...q.topic_ids]));
          if (found) return found;
        }
        return undefined;
      };
      const combination = search([], new Set());
      if (!combination) fail('INVALID_BLUEPRINT', `蓝图 ${id} 不能满足知识点覆盖`);
      picked = [
        ...combination,
        ...candidates
          .filter((q) => !combination.includes(q))
          .slice(0, section.count - combination.length),
      ];
    }
    chosen.push(...picked);
  }
  return structuredClone(chosen);
}
