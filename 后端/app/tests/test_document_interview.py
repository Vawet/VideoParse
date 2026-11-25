from unittest.mock import patch
import pytest
from app.services import document_interview as interview


def test_rubric_requires_verbatim_notes():
    body = "分页按页号访问。游标按上次排序键继续。"
    prompt = {"question":"比较两种分页策略", "points":[{"label":"定位方式", "quote":"按页号访问"}]}
    with patch.object(interview, "_generate", return_value=prompt):
        assert interview.question("分页", body)["points"] == prompt["points"]
        with pytest.raises(interview.InvalidRubric):
            interview.question("其他", "没有提到分页")


def test_per_point_grade_requires_an_actual_answer_quote_and_followup():
    points = [{"label":"排序键","quote":"按上次排序键继续"}, {"label":"页号","quote":"按页号访问"}]
    reply = {"marks":[{"id":2,"hit":False,"feedback":"还需说明页号"},
                      {"id":1,"hit":True,"evidence":"上个键","feedback":"已解释继续位置"}],
             "followup":"另一种方式如何定位？"}
    with patch.object(interview, "_generate", return_value=reply):
        result=interview.grade("如何分页？",points,"记住上个键")
        assert result["score"]==1 and result["marks"][0]["label"]=="排序键" and result["followup"]
        with pytest.raises(interview.InvalidRubric):
            interview.grade("如何分页？",points,"与出处无关")
        reply["marks"][0]["id"]=1
        with pytest.raises(interview.InvalidRubric):
            interview.grade("如何分页？",points,"上个键")
