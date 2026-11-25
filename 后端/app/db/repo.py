"""数据访问函数。上层（工具/接口）只依赖这里，不直接写 SQL。"""
import datetime as dt
import logging
from typing import List, Optional

from sqlalchemy import select

from app.db.models import Attempt, Course, Question, Quiz, StudyProfile, TeachPlan, TranscriptChunk, Video
from app.db.session import get_session

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ 视频
def register_video(video_id: str, title: str = "", course_id: Optional[str] = None, duration: float = 0):
    """登记视频（已存在则只更新非空字段）。"""
    with get_session() as s:
        v = s.get(Video, video_id)
        if v is None:
            s.add(Video(id=video_id, title=title, course_id=course_id, duration=duration))
        else:
            if title:
                v.title = title
            if course_id:
                v.course_id = course_id
            if duration:
                v.duration = duration


def index_video(video_id: str, segments: List[dict], duration: float = 0):
    """解析完成后：标记 analyzed，并（重新）写入字幕分块。"""
    register_video(video_id, duration=duration)
    with get_session() as s:
        v = s.get(Video, video_id)
        v.status = "analyzed"
        for old in s.scalars(select(TranscriptChunk).where(TranscriptChunk.video_id == video_id)):
            s.delete(old)
        for i, seg in enumerate(segments):
            s.add(TranscriptChunk(video_id=video_id, idx=i, start_sec=float(seg["start_time"]),
                                  end_sec=float(seg["end_time"]), text=seg["text"]))


def get_transcript(video_id: str, *, course_id: Optional[str] = None) -> List[dict]:
    with get_session() as s:
        query = select(TranscriptChunk).where(TranscriptChunk.video_id == video_id)
        if course_id is not None:
            query = query.join(Video, Video.id == TranscriptChunk.video_id).where(Video.course_id == course_id)
        rows = s.scalars(query.order_by(TranscriptChunk.idx)).all()
        return [{"start_time": r.start_sec, "end_time": r.end_sec, "text": r.text} for r in rows]


def get_video(video_id: str) -> Optional[dict]:
    with get_session() as s:
        v = s.get(Video, video_id)
        if not v:
            return None
        return {"id": v.id, "title": v.title or v.id[:8], "course_id": v.course_id,
                "duration": v.duration, "status": v.status}


# ------------------------------------------------------------------ 课程
def create_course(name: str) -> dict:
    with get_session() as s:
        c = Course(name=name)
        s.add(c)
        s.flush()
        return {"id": c.id, "name": c.name}


def list_courses() -> List[dict]:
    with get_session() as s:
        return [{"id": c.id, "name": c.name, "video_count": len(c.videos)} for c in s.scalars(select(Course))]


def get_course(course_id: str) -> Optional[dict]:
    with get_session() as s:
        c = s.get(Course, course_id)
        if not c:
            return None
        return {"id": c.id, "name": c.name,
                "videos": [{"id": v.id, "title": v.title or v.id[:8], "duration": v.duration, "status": v.status}
                           for v in c.videos]}


def add_video_to_course(course_id: str, video_id: str) -> bool:
    with get_session() as s:
        if not s.get(Course, course_id):
            return False
        v = s.get(Video, video_id)
        if v is None:
            v = Video(id=video_id)
            s.add(v)
        v.course_id = course_id
        return True


def course_transcripts(course_id: str) -> List[dict]:
    """课程下所有视频的字幕分块，带视频标题（检索层使用）。"""
    with get_session() as s:
        rows = s.execute(
            select(TranscriptChunk, Video).join(Video, Video.id == TranscriptChunk.video_id)
            .where(Video.course_id == course_id).order_by(Video.created_at, TranscriptChunk.idx)
        ).all()
        return [{"video_id": v.id, "video_title": v.title or v.id[:8], "start": c.start_sec, "end": c.end_sec,
                 "text": c.text} for c, v in rows]


def course_video_ids(course_id: str) -> List[str]:
    with get_session() as s:
        return [v.id for v in s.scalars(select(Video).where(Video.course_id == course_id))]


# ------------------------------------------------------------------ 题目
def save_quiz(video_id: Optional[str], course_id: Optional[str], topic: str, difficulty: str,
              questions: List[dict]) -> dict:
    with get_session() as s:
        quiz = Quiz(video_id=video_id, course_id=course_id, topic=topic, difficulty=difficulty)
        s.add(quiz)
        s.flush()
        out = []
        for q in questions:
            row = Question(quiz_id=quiz.id, qtype=q["qtype"], stem=q["stem"], options=q.get("options"),
                           answer=q["answer"], explanation=q.get("explanation", ""),
                           difficulty=q.get("difficulty", difficulty), topic=q.get("topic", topic),
                           evidence=q.get("evidence", []), verified=bool(q.get("verified")))
            s.add(row)
            s.flush()
            out.append(question_to_dict(row))
        return {"id": quiz.id, "topic": topic, "difficulty": difficulty, "questions": out}


def question_to_dict(q: Question, with_answer: bool = True) -> dict:
    d = {"id": q.id, "qtype": q.qtype, "stem": q.stem, "options": q.options, "topic": q.topic,
         "difficulty": q.difficulty, "evidence": q.evidence, "verified": q.verified}
    if with_answer:
        d.update(answer=q.answer, explanation=q.explanation)
    return d


def get_question(question_id: str) -> Optional[dict]:
    with get_session() as s:
        q = s.get(Question, question_id)
        return question_to_dict(q) if q else None


def get_quiz(quiz_id: str, with_answer: bool = False) -> Optional[dict]:
    with get_session() as s:
        quiz = s.get(Quiz, quiz_id)
        if not quiz:
            return None
        return {"id": quiz.id, "topic": quiz.topic, "difficulty": quiz.difficulty,
                "video_id": quiz.video_id, "course_id": quiz.course_id,
                "questions": [question_to_dict(q, with_answer) for q in quiz.questions]}


def record_attempt(client_id: str, question_id: str, given_answer: str, correct: bool):
    with get_session() as s:
        s.add(Attempt(client_id=client_id, question_id=question_id, given_answer=given_answer, correct=correct))


# ------------------------------------------------------------------ 学习记录 / 薄弱点
def _scope_ok(quiz: Quiz, course_id, video_id, course_videos) -> bool:
    if video_id:
        return quiz.video_id == video_id
    if course_id:
        return quiz.course_id == course_id or quiz.video_id in course_videos
    return True


def weak_topics(client_id: str, course_id: Optional[str] = None, video_id: Optional[str] = None,
                limit: int = 10, threshold: float = 0.7) -> dict:
    """按知识点汇总：每道题只看最近一次作答（做错后重做对了就不再算薄弱）。
    返回 {"topics": [{topic, attempted, wrong, accuracy, evidence[]}], "attempted": n}，薄弱的排前面。"""
    with get_session() as s:
        course_videos = set()
        if course_id:
            course_videos = {v.id for v in s.scalars(select(Video).where(Video.course_id == course_id))}
        rows = s.execute(
            select(Attempt, Question, Quiz).join(Question, Question.id == Attempt.question_id)
            .join(Quiz, Quiz.id == Question.quiz_id).where(Attempt.client_id == client_id)
            .order_by(Attempt.created_at, Attempt.id)
        ).all()
        latest = {}
        for a, q, quiz in rows:
            if _scope_ok(quiz, course_id, video_id, course_videos):
                latest[q.id] = (a, q)
        by_topic = {}
        for a, q in latest.values():
            t = by_topic.setdefault(q.topic or "综合", {"topic": q.topic or "综合", "attempted": 0, "wrong": 0, "evidence": []})
            t["attempted"] += 1
            if not a.correct:
                t["wrong"] += 1
                for e in (q.evidence or [])[:1]:
                    if e not in t["evidence"] and len(t["evidence"]) < 2:
                        t["evidence"].append(e)
        topics = []
        for t in by_topic.values():
            t["accuracy"] = round(1 - t["wrong"] / t["attempted"], 2)
            t["weak"] = t["accuracy"] < threshold
            topics.append(t)
        topics.sort(key=lambda t: (not t["weak"], -t["wrong"], t["accuracy"]))
        return {"topics": topics[:limit], "attempted": len(latest)}


def get_profile(client_id: str, course_id: str) -> Optional[dict]:
    with get_session() as s:
        p = s.scalars(select(StudyProfile).where(StudyProfile.client_id == client_id,
                                                 StudyProfile.course_id == course_id)).first()
        if not p:
            return None
        return {"exam_date": p.exam_date.isoformat() if p.exam_date else None,
                "daily_minutes": p.daily_minutes, "done_items": list(p.done_items or [])}


def upsert_profile(client_id: str, course_id: str, exam_date: Optional[dt.date] = None,
                   daily_minutes: Optional[int] = None):
    with get_session() as s:
        p = s.scalars(select(StudyProfile).where(StudyProfile.client_id == client_id,
                                                 StudyProfile.course_id == course_id)).first()
        if not p:
            p = StudyProfile(client_id=client_id, course_id=course_id, done_items=[])
            s.add(p)
        if exam_date is not None:
            p.exam_date = exam_date
        if daily_minutes:
            p.daily_minutes = int(daily_minutes)


def set_item_done(client_id: str, course_id: str, item_id: str, done: bool = True):
    with get_session() as s:
        p = s.scalars(select(StudyProfile).where(StudyProfile.client_id == client_id,
                                                 StudyProfile.course_id == course_id)).first()
        if not p:
            p = StudyProfile(client_id=client_id, course_id=course_id, done_items=[])
            s.add(p)
        items = [i for i in (p.done_items or []) if i != item_id]
        if done:
            items.append(item_id)
        p.done_items = items  # 重新赋值，保证 JSON 列变更被追踪


# ------------------------------------------------------------------ 备课方案（带版本）
def save_teach_plan(course_id: str, topic: str, minutes: int, data: dict, parent_id: Optional[str] = None,
                    instruction: str = "") -> dict:
    with get_session() as s:
        version = 1
        if parent_id:
            parent = s.get(TeachPlan, parent_id)
            version = (parent.version if parent else 0) + 1
        row = TeachPlan(course_id=course_id, topic=topic, minutes=minutes, data=data, parent_id=parent_id,
                        version=version, instruction=instruction)
        s.add(row)
        s.flush()
        return {"id": row.id, "version": version, "parent_id": parent_id}


def get_teach_plan(plan_id: str) -> Optional[dict]:
    with get_session() as s:
        r = s.get(TeachPlan, plan_id)
        if not r:
            return None
        return {"id": r.id, "course_id": r.course_id, "parent_id": r.parent_id, "version": r.version,
                "topic": r.topic, "minutes": r.minutes, "instruction": r.instruction, "plan": r.data}


def teach_plan_history(plan_id: str) -> List[dict]:
    """从给定版本沿 parent 链回溯到第 1 版（新→旧）。"""
    out, cur = [], plan_id
    with get_session() as s:
        while cur:
            r = s.get(TeachPlan, cur)
            if not r:
                break
            out.append({"id": r.id, "version": r.version, "instruction": r.instruction, "minutes": r.minutes})
            cur = r.parent_id
    return out
