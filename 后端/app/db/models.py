"""数据库模型（SQLAlchemy 2.0）。SQLite 与 Postgres 通用；JSON 列在 Postgres 上是 JSON 类型。"""
import datetime as dt
import uuid
from typing import List, Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> dt.datetime:
    return dt.datetime.utcnow()


class Base(DeclarativeBase):
    pass


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    videos: Mapped[List["Video"]] = relationship(back_populates="course")


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 即后端 video_id
    course_id: Mapped[Optional[str]] = mapped_column(ForeignKey("courses.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    duration: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(20), default="uploaded")  # uploaded / analyzed
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    course: Mapped[Optional[Course]] = relationship(back_populates="videos")


class TranscriptChunk(Base):
    __tablename__ = "transcript_chunks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    start_sec: Mapped[float] = mapped_column(Float)
    end_sec: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)


class Quiz(Base):
    __tablename__ = "quizzes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    video_id: Mapped[Optional[str]] = mapped_column(ForeignKey("videos.id"), nullable=True, index=True)
    course_id: Mapped[Optional[str]] = mapped_column(ForeignKey("courses.id"), nullable=True, index=True)
    topic: Mapped[str] = mapped_column(String(200), default="")
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    questions: Mapped[List["Question"]] = relationship(back_populates="quiz", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    quiz_id: Mapped[str] = mapped_column(ForeignKey("quizzes.id"), index=True)
    qtype: Mapped[str] = mapped_column(String(20))  # single / judge / blank
    stem: Mapped[str] = mapped_column(Text)
    options: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    answer: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text, default="")
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")
    topic: Mapped[str] = mapped_column(String(200), default="")  # 知识点，用于薄弱点统计
    evidence: Mapped[list] = mapped_column(JSON, default=list)  # [{video_id,start,end,quote}]
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    quiz: Mapped[Quiz] = relationship(back_populates="questions")


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id"), index=True)
    given_answer: Mapped[str] = mapped_column(Text, default="")
    correct: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class StudyProfile(Base):
    __tablename__ = "study_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"))
    exam_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    daily_minutes: Mapped[int] = mapped_column(Integer, default=60)
    done_items: Mapped[list] = mapped_column(JSON, default=list)  # 已完成的复习项 id


class TeachPlan(Base):
    """教师备课方案；每次修改生成新版本（parent_id 指向上一版），可回溯。"""
    __tablename__ = "teach_plans"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    parent_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    topic: Mapped[str] = mapped_column(String(200), default="")
    minutes: Mapped[int] = mapped_column(Integer, default=45)
    instruction: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
