import type { State, Progress, Evidence } from '../contracts/index.js';
export function rebuildProgress(state: State) {
  const progress: State['progress'] = {};
  const evidence: State['evidence'] = {};
  for (const goal of Object.values(state.goals)) {
    const pack = state.packs[`${goal.pack_id}@${goal.pack_version}`]?.pack;
    if (!pack) continue;
    for (const topic of pack.topics) {
      const p: Progress = {
        goal_id: goal.id,
        topic_id: topic.id,
        exposures: 0,
        attempts: 0,
        correct: 0,
        earned: 0,
        possible: 0,
        mastery: 'unknown',
      };
      progress[`${goal.id}:${topic.id}`] = p;
    }
  }
  for (const lesson of Object.values(state.lessons).filter((l) => l.status === 'published'))
    for (const id of lesson.topic_ids) {
      const p = progress[`${lesson.goal_id}:${id}`];
      if (p) p.exposures++;
    }
  const reviews = Object.values(state.reviews).sort(
    (a, b) =>
      state.attempts[a.attempt_id].submitted_at!.localeCompare(
        state.attempts[b.attempt_id].submitted_at!,
      ) || a.id.localeCompare(b.id),
  );
  for (const review of reviews) {
    const attempt = state.attempts[review.attempt_id];
    const lesson = state.lessons[attempt.lesson_id];
    const topicTotals = new Map<string, { earned: number; possible: number }>();
    for (const grade of review.grades) {
      const q = lesson.questions.find((q) => q.id === grade.question_id)!;
      for (const topicId of new Set(q.topic_ids)) {
        const p = progress[`${attempt.goal_id}:${topicId}`];
        p.attempts++;
        p.correct += grade.score === q.points ? 1 : 0;
        p.earned += grade.score;
        p.possible += q.points;
        p.last_practiced_at = attempt.submitted_at;
        const t = topicTotals.get(topicId) ?? { earned: 0, possible: 0 };
        t.earned += grade.score;
        t.possible += q.points;
        topicTotals.set(topicId, t);
        const id = `${attempt.id}:${q.id}:${topicId}`;
        const e: Evidence = {
          id,
          goal_id: attempt.goal_id,
          topic_id: topicId,
          attempt_id: attempt.id,
          review_id: review.id,
          review_version: review.version,
          question_id: q.id,
          score: grade.score,
          possible: q.points,
          kind: lesson.kind,
          at: attempt.submitted_at!,
        };
        evidence[id] = e;
      }
    }
    for (const [topic, t] of topicTotals) {
      const p = progress[`${attempt.goal_id}:${topic}`];
      const fraction = t.earned / t.possible;
      const days = fraction < 0.6 ? 1 : fraction < 0.85 ? 3 : 7;
      p.due_at = new Date(Date.parse(attempt.submitted_at!) + days * 86400000).toISOString();
    }
  }
  for (const p of Object.values(progress))
    p.mastery =
      p.attempts === 0
        ? 'unknown'
        : p.earned / p.possible >= 0.85 && p.attempts >= 2
          ? 'demonstrated'
          : p.earned / p.possible >= 0.6
            ? 'practicing'
            : 'learning';
  state.progress = progress;
  state.evidence = evidence;
}
