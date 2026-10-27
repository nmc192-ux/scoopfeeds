/**
 * OriginalsQuizPage — `/originals/quiz` under SITE_V2 (#271): "Did you scoop it?".
 *
 * The week's published quiz, all questions on one page. Scoring is client-side
 * only; nothing about the reader's answers is sent to the server. A finished
 * score is remembered in localStorage per week (wrapped in try/catch: the page
 * works without it).
 *
 * Earn-render: with no quiz (API 404) only the header and a link back to
 * /originals render. The AI disclosure is always shown under the heading when a
 * quiz is shown. Without v2 the route redirects to /briefs (App.jsx).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOriginalsQuiz } from "../hooks/useOriginals";

const READING = 'var(--sf-reading, "Newsreader", Georgia, "Times New Roman", serif)';
const LABEL = 'var(--sf-label, "Schibsted Grotesk", system-ui, sans-serif)';
const DISPLAY = 'var(--sf-display, "Anton", Impact, system-ui, sans-serif)';
const INK = "var(--sf-ink, #090706)";
const RIGHT = "#1f7a3a";
const WRONG = "#b3261e";

const storeKey = (week) => `sf-quiz-score:${week}`;
function readScore(week) {
  try { return window.localStorage.getItem(storeKey(week)); } catch { return null; }
}
function writeScore(week, value) {
  try { window.localStorage.setItem(storeKey(week), value); } catch { /* storage unavailable: fine */ }
}

function Question({ n, item, picked, onPick }) {
  const answered = picked !== undefined;
  return (
    <li className="border-t pt-6" style={{ borderColor: INK }} data-testid="quiz-question">
      <p className="text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }}>Question {n}</p>
      <h2 className="mt-1 text-xl leading-snug" style={{ fontFamily: READING, color: INK }}>{item.q}</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {item.choices.map((c, i) => {
          const isAnswer = i === item.answer;
          const isPicked = i === picked;
          let style = { fontFamily: LABEL, borderColor: INK, color: INK };
          if (answered && isAnswer) style = { ...style, borderColor: RIGHT, background: RIGHT, color: "#fff" };
          else if (answered && isPicked) style = { ...style, borderColor: WRONG, color: WRONG };
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => onPick(i)}
              className={`text-left border-2 px-3 py-2 ${answered ? "" : "hover:underline"}`}
              style={style}
            >
              {c}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className="mt-3 text-base" style={{ fontFamily: READING }}>
          <strong style={{ color: picked === item.answer ? RIGHT : WRONG }}>
            {picked === item.answer ? "Right." : `Not quite. The answer is ${item.choices[item.answer]}.`}
          </strong>{" "}
          {item.event?.slug && (
            <Link to={`/events/${item.event.slug}`} className="underline">Read the dossier</Link>
          )}
        </p>
      )}
    </li>
  );
}

export default function OriginalsQuizPage() {
  const { data: quiz } = useOriginalsQuiz();
  const [picks, setPicks] = useState({});
  const [previous, setPrevious] = useState(null);

  const questions = quiz?.questions ?? [];
  const week = quiz?.week_start;
  const done = questions.length > 0 && questions.every((_, i) => picks[i] !== undefined);
  const score = questions.reduce((s, q, i) => s + (picks[i] === q.answer ? 1 : 0), 0);

  useEffect(() => { if (week) setPrevious(readScore(week)); }, [week]);
  useEffect(() => { if (done && week) writeScore(week, `${score}/${questions.length}`); }, [done, week, score, questions.length]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8" data-testid="originals-quiz-page">
      <header>
        <p className="text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }}>
          <Link to="/originals" className="underline">Originals</Link>
        </p>
        <h1 className="mt-1 uppercase text-4xl sm:text-5xl" style={{ fontFamily: DISPLAY, color: INK }}>Did you scoop it?</h1>
        {quiz && questions.length > 0 && (
          <>
            <p className="mt-2 text-lg opacity-80" style={{ fontFamily: READING }}>
              {questions.length} questions on this week's news.
            </p>
            <p className="mt-2 text-sm opacity-70" style={{ fontFamily: LABEL }} data-testid="quiz-disclosure">
              {quiz.disclosure}
            </p>
            {previous && !done && (
              <p className="mt-2 text-sm opacity-70" style={{ fontFamily: LABEL }}>You scored {previous} on this quiz before.</p>
            )}
          </>
        )}
      </header>

      {questions.length > 0 && (
        <ol className="mt-8 space-y-6 list-none p-0">
          {questions.map((item, i) => (
            <Question key={i} n={i + 1} item={item} picked={picks[i]}
                      onPick={(c) => setPicks((p) => (p[i] === undefined ? { ...p, [i]: c } : p))} />
          ))}
        </ol>
      )}

      {done && (
        <section className="mt-10 border-2 p-6 text-center" style={{ borderColor: INK }} data-testid="quiz-score">
          <p className="uppercase text-3xl" style={{ fontFamily: DISPLAY, color: INK }}>
            You scored {score} out of {questions.length}
          </p>
          <p className="mt-3" style={{ fontFamily: LABEL }}>
            <Link to="/originals" className="underline">Back to Originals</Link>
          </p>
        </section>
      )}
    </main>
  );
}
