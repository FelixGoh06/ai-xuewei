#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI学委 / GYFileHub admin helper for OpenClaw skills.

The same API paths work for Cloudflare Pages and the Linux adapter. Configure:
  AI_XUEWEI_BASE_URL=http://127.0.0.1:3000
  AI_XUEWEI_ADMIN_USER=admin
  AI_XUEWEI_ADMIN_PASSWORD=123456
or:
  AI_XUEWEI_ADMIN_TOKEN=...
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, Iterable, List, Optional

import requests


DEFAULT_COLUMNS = ["classname", "name", "id"]
CLASS_KEYS = ("classname", "className", "class")
NAME_KEYS = ("name",)
ID_KEYS = ("id", "studentId")


def emit(data: Any, status: int = 0) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))
    raise SystemExit(status)


def read_value(value: str) -> str:
    if value and value.startswith("@"):
        with open(value[1:], "r", encoding="utf-8") as fh:
            return fh.read()
    return value or ""


def csv(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def first(row: Dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def class_alias(value: str) -> str:
    text = str(value or "").strip()
    text = text.replace("class", "").strip()
    digits = re.findall(r"\d+", text)
    if digits and len("".join(digits)) == len(re.sub(r"\D+", "", text)):
        text = digits[-1]
    if text.isdigit():
        return str(int(text)).zfill(2)
    return text.lower()


class AiXueweiClient:
    def __init__(self, base_url: str, token: str = "", username: str = "", password: str = "", timeout: float = 25) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.token = token.strip()
        self.username = username.strip()
        self.password = password
        self.timeout = timeout
        if not self.base_url:
            raise ValueError("Missing Base URL. Set AI_XUEWEI_BASE_URL or pass --base-url.")

    def url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def ensure_auth(self) -> None:
        if self.token:
            return
        if not self.username or not self.password:
            raise ValueError("Missing admin credentials. Set AI_XUEWEI_ADMIN_TOKEN, or set AI_XUEWEI_ADMIN_USER and AI_XUEWEI_ADMIN_PASSWORD.")
        res = requests.post(
            self.url("/api/admin/login"),
            json={"username": self.username, "password": self.password},
            timeout=self.timeout,
        )
        self._raise(res)
        data = res.json()
        self.token = str(data.get("token") or "").strip()
        if not self.token:
            raise ValueError("Login succeeded but no token was returned.")

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        self.ensure_auth()
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self.token}"
        res = requests.request(method, self.url(path), headers=headers, timeout=self.timeout, **kwargs)
        self._raise(res)
        if not res.text:
            return {}
        try:
            return res.json()
        except ValueError:
            return {"text": res.text}

    def core_get(self, action: str, **params: Any) -> Any:
        clean = {"action": action}
        clean.update({k: v for k, v in params.items() if v is not None and v != ""})
        return self.request("GET", "/api/admin/core", params=clean)

    def core_post(self, body: Dict[str, Any]) -> Any:
        return self.request("POST", "/api/admin/core", json=body)

    def dashboard(self) -> Any:
        return self.request("GET", "/api/admin/dashboard")

    @staticmethod
    def _raise(res: requests.Response) -> None:
        if res.ok:
            return
        message = res.text
        try:
            payload = res.json()
            message = payload.get("error") or payload.get("message") or message
        except ValueError:
            pass
        raise RuntimeError(f"HTTP {res.status_code}: {message}")


def client_from_args(args: argparse.Namespace) -> AiXueweiClient:
    return AiXueweiClient(
        base_url=args.base_url or os.getenv("AI_XUEWEI_BASE_URL") or os.getenv("SCHOLARIS_BASE_URL") or os.getenv("FILEHUB_BASE_URL") or "http://127.0.0.1:3000",
        token=args.token or os.getenv("AI_XUEWEI_ADMIN_TOKEN") or os.getenv("SCHOLARIS_ADMIN_TOKEN") or os.getenv("FILEHUB_ADMIN_TOKEN") or "",
        username=args.username or os.getenv("AI_XUEWEI_ADMIN_USER") or os.getenv("SCHOLARIS_ADMIN_USER") or os.getenv("FILEHUB_ADMIN_USER") or "",
        password=args.password or os.getenv("AI_XUEWEI_ADMIN_PASSWORD") or os.getenv("SCHOLARIS_ADMIN_PASSWORD") or os.getenv("FILEHUB_ADMIN_PASSWORD") or "",
        timeout=args.timeout,
    )


def rows_and_columns(client: AiXueweiClient) -> tuple[List[Dict[str, Any]], List[str]]:
    data = client.core_get("students")
    rows = data.get("students") or data.get("rows") or []
    columns = data.get("columns") or DEFAULT_COLUMNS
    if "name" not in columns:
        columns = list(columns) + ["name"]
    return rows, columns


def save_rows(client: AiXueweiClient, rows: List[Dict[str, Any]], columns: List[str]) -> Any:
    return client.core_post({"action": "saveStudentsBulk", "rows": rows, "columns": columns})


def handle_submissions(client: AiXueweiClient, args: argparse.Namespace) -> Any:
    if args.all:
        msg = "query all assignment submission status"
    else:
        msg = f"query submission status for assignment {args.subject}"
    return client.core_post({"action": "adminAssistant", "message": msg, "context": {}})


def handle_ask(client: AiXueweiClient, args: argparse.Namespace) -> Any:
    return client.core_post({"action": "adminAssistant", "message": read_value(args.message), "context": {}})


def handle_students(client: AiXueweiClient, args: argparse.Namespace) -> Any:
    rows, columns = rows_and_columns(client)
    if args.student_action == "list":
        if args.class_name:
            target = class_alias(args.class_name)
            rows = [row for row in rows if class_alias(first(row, CLASS_KEYS)) == target]
        return {"success": True, "columns": columns, "count": len(rows), "students": rows}

    if args.student_action == "add":
        row = {col: "" for col in columns}
        name_key = next((k for k in NAME_KEYS if k in columns), "name")
        id_key = next((k for k in ID_KEYS if k in columns), "id")
        class_key = next((k for k in CLASS_KEYS if k in columns), "classname")
        for key in (name_key, id_key, class_key):
            if key not in columns:
                columns.append(key)
        row[name_key] = args.name
        row[id_key] = args.student_id or ""
        row[class_key] = args.class_name or ""
        for item in args.field or []:
            if "=" not in item:
                raise ValueError(f"--field must be key=value: {item}")
            key, value = item.split("=", 1)
            key = key.strip()
            if key and key not in columns:
                columns.append(key)
            if key:
                row[key] = value.strip()
        return save_rows(client, rows + [row], columns)

    if args.student_action == "delete":
        before = len(rows)
        next_rows = [row for row in rows if first(row, NAME_KEYS) != args.name]
        result = save_rows(client, next_rows, columns)
        result["removed"] = before - len(next_rows)
        return result

    if args.student_action == "delete-class":
        target = class_alias(args.class_name)
        removed = [row for row in rows if class_alias(first(row, CLASS_KEYS)) == target]
        next_rows = [row for row in rows if class_alias(first(row, CLASS_KEYS)) != target]
        result = save_rows(client, next_rows, columns)
        result["removed"] = len(removed)
        result["removedStudents"] = removed
        return result

    if args.student_action == "reset-password":
        return client.core_post({"action": "resetStudentPassword", "name": args.name, "mode": args.mode})

    raise ValueError("Unknown students action.")


def handle_subject(client: AiXueweiClient, args: argparse.Namespace) -> Any:
    if args.subject_action == "list":
        return client.dashboard()
    if args.subject_action == "create":
        return client.core_post({"action": "addSubject", "subject": args.subject})
    if args.subject_action == "delete":
        return client.core_post({"action": "delete", "key": args.subject, "isFolder": True})
    raise ValueError("Unknown subject action.")


def handle_files(client: AiXueweiClient, args: argparse.Namespace) -> Any:
    if args.file_action == "list":
        return client.core_get("files", folder=args.subject)
    if args.file_action == "delete":
        return client.core_post({"action": "delete", "key": args.key, "isFolder": False})
    raise ValueError("Unknown file action.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AI学委 admin operator for OpenClaw")
    parser.add_argument("--base-url")
    parser.add_argument("--token")
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument("--timeout", type=float, default=25)
    parser.add_argument("--subject", help="legacy: query one assignment submission status")
    parser.add_argument("--all", action="store_true", help="legacy: query all assignment submission status")
    sub = parser.add_subparsers(dest="command")

    ask = sub.add_parser("ask")
    ask.add_argument("--message", required=True)

    submissions = sub.add_parser("submissions")
    submissions.add_argument("--subject")
    submissions.add_argument("--all", action="store_true")

    students = sub.add_parser("students")
    students_sub = students.add_subparsers(dest="student_action", required=True)
    st_list = students_sub.add_parser("list")
    st_list.add_argument("--class-name")
    st_add = students_sub.add_parser("add")
    st_add.add_argument("--name", required=True)
    st_add.add_argument("--id", dest="student_id")
    st_add.add_argument("--class-name")
    st_add.add_argument("--field", action="append")
    st_del = students_sub.add_parser("delete")
    st_del.add_argument("--name", required=True)
    st_del_class = students_sub.add_parser("delete-class")
    st_del_class.add_argument("--class-name", required=True)
    st_reset = students_sub.add_parser("reset-password")
    st_reset.add_argument("--name", required=True)
    st_reset.add_argument("--mode", choices=["random", "default"], default="random")

    subject = sub.add_parser("subject")
    subject_sub = subject.add_subparsers(dest="subject_action", required=True)
    subject_sub.add_parser("list")
    sj_create = subject_sub.add_parser("create")
    sj_create.add_argument("--subject", required=True)
    sj_delete = subject_sub.add_parser("delete")
    sj_delete.add_argument("--subject", required=True)

    files = sub.add_parser("files")
    files_sub = files.add_subparsers(dest="file_action", required=True)
    fl_list = files_sub.add_parser("list")
    fl_list.add_argument("--subject", required=True)
    fl_delete = files_sub.add_parser("delete")
    fl_delete.add_argument("--key", required=True)

    grade = sub.add_parser("grade")
    grade_sub = grade.add_subparsers(dest="grade_action", required=True)
    gr_save = grade_sub.add_parser("save")
    gr_save.add_argument("--subject", required=True)
    gr_save.add_argument("--name", required=True)
    gr_save.add_argument("--score", required=True)
    gr_save.add_argument("--comment", default="")

    deadline = sub.add_parser("deadline")
    deadline_sub = deadline.add_subparsers(dest="deadline_action", required=True)
    dl_set = deadline_sub.add_parser("set")
    dl_set.add_argument("--subject", required=True)
    dl_set.add_argument("--deadline", default="")

    naming = sub.add_parser("naming")
    naming_sub = naming.add_subparsers(dest="naming_action", required=True)
    nm_set = naming_sub.add_parser("set")
    nm_set.add_argument("--subject", required=True)
    nm_set.add_argument("--template", default="")

    requirement = sub.add_parser("requirement")
    req_sub = requirement.add_subparsers(dest="requirement_action", required=True)
    rq_set = req_sub.add_parser("set")
    rq_set.add_argument("--subject", required=True)
    rq_set.add_argument("--content", default="")

    settings = sub.add_parser("settings")
    settings_sub = settings.add_subparsers(dest="settings_action", required=True)
    ss_set = settings_sub.add_parser("set")
    ss_set.add_argument("--subject", required=True)
    ss_set.add_argument("--extensions", default="")
    ss_set.add_argument("--plagiarism-mode", default="")
    ss_set.add_argument("--classes", default="")

    notice = sub.add_parser("notice")
    notice_sub = notice.add_subparsers(dest="notice_action", required=True)
    nt_set = notice_sub.add_parser("set")
    nt_set.add_argument("--title", required=True)
    nt_set.add_argument("--content", required=True)
    nt_set.add_argument("--publish-at", default="")
    nt_set.add_argument("--expire-at", default="")

    ai_rules = sub.add_parser("ai-rules")
    ai_sub = ai_rules.add_subparsers(dest="ai_action", required=True)
    ai_set = ai_sub.add_parser("set")
    ai_set.add_argument("--subject", default="")
    ai_set.add_argument("--requirements", default="")
    ai_set.add_argument("--faq", default="")
    ai_set.add_argument("--examples", default="")

    model = sub.add_parser("model")
    model_sub = model.add_subparsers(dest="model_action", required=True)
    model_sub.add_parser("get")
    model_sub.add_parser("test")
    md_set = model_sub.add_parser("set")
    md_set.add_argument("--base-url", dest="ai_base_url", default="")
    md_set.add_argument("--api-key", default="")
    md_set.add_argument("--light-model", default="")
    md_set.add_argument("--heavy-model", default="")
    md_set.add_argument("--embedding-model", default="")
    md_set.add_argument("--timeout-ms", type=int, default=0)

    admin = sub.add_parser("admin")
    admin_sub = admin.add_subparsers(dest="admin_action", required=True)
    admin_sub.add_parser("list")
    ad_create = admin_sub.add_parser("create")
    ad_create.add_argument("--username", required=True)
    ad_create.add_argument("--password", required=True)
    ad_reset = admin_sub.add_parser("reset-password")
    ad_reset.add_argument("--username", required=True)
    ad_reset.add_argument("--password", required=True)
    ad_change = admin_sub.add_parser("change-password")
    ad_change.add_argument("--old-password", required=True)
    ad_change.add_argument("--new-password", required=True)

    audit = sub.add_parser("audit")
    audit_sub = audit.add_subparsers(dest="audit_action", required=True)
    au_list = audit_sub.add_parser("list")
    au_list.add_argument("--limit", type=int, default=100)
    return parser


def dispatch(client: AiXueweiClient, args: argparse.Namespace) -> Any:
    if args.all or (args.subject and not args.command):
        compat = argparse.Namespace(all=args.all, subject=args.subject)
        return handle_submissions(client, compat)
    if args.command == "ask":
        return handle_ask(client, args)
    if args.command == "submissions":
        if not args.all and not args.subject:
            raise ValueError("Pass --all or --subject.")
        return handle_submissions(client, args)
    if args.command == "students":
        return handle_students(client, args)
    if args.command == "subject":
        return handle_subject(client, args)
    if args.command == "files":
        return handle_files(client, args)
    if args.command == "grade":
        return client.core_post({"action": "saveGrades", "subject": args.subject, "items": [{"name": args.name, "score": args.score, "comment": args.comment}]})
    if args.command == "deadline":
        return client.core_post({"action": "setDeadline", "subject": args.subject, "deadline": args.deadline})
    if args.command == "naming":
        return client.core_post({"action": "setNamingRule", "subject": args.subject, "template": args.template})
    if args.command == "requirement":
        return client.core_post({"action": "setAssignmentRequirement", "subject": args.subject, "content": read_value(args.content)})
    if args.command == "settings":
        return client.core_post({
            "action": "setSubjectSettings",
            "subject": args.subject,
            "allowedExtensions": csv(args.extensions),
            "plagiarismMode": args.plagiarism_mode,
            "classNames": csv(args.classes),
        })
    if args.command == "notice":
        return client.core_post({"action": "updateNotice", "title": args.title, "content": read_value(args.content), "publishAt": args.publish_at, "expireAt": args.expire_at})
    if args.command == "ai-rules":
        return client.core_post({"action": "setAiRules", "subject": args.subject, "requirements": read_value(args.requirements), "faq": read_value(args.faq), "examples": read_value(args.examples)})
    if args.command == "model":
        if args.model_action == "get":
            return client.core_get("modelSettings")
        if args.model_action == "test":
            return client.core_post({"action": "testModelSettings"})
        return client.core_post({
            "action": "setModelSettings",
            "aiBaseUrl": args.ai_base_url,
            "apiKey": args.api_key,
            "lightModel": args.light_model,
            "heavyModel": args.heavy_model,
            "embeddingModel": args.embedding_model,
            "timeoutMs": args.timeout_ms or None,
        })
    if args.command == "admin":
        if args.admin_action == "list":
            return client.core_post({"action": "adminUsers"})
        if args.admin_action == "create":
            return client.core_post({"action": "createAdminUser", "username": args.username, "password": args.password})
        if args.admin_action == "reset-password":
            return client.core_post({"action": "resetAdminPassword", "username": args.username, "password": args.password})
        return client.core_post({"action": "changeAdminPassword", "oldPassword": args.old_password, "newPassword": args.new_password})
    if args.command == "audit":
        return client.core_get("auditLogs", limit=args.limit)
    raise ValueError("Pass a command to execute.")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        client = client_from_args(args)
        emit(dispatch(client, args))
    except Exception as exc:
        emit({"success": False, "error": str(exc)}, 1)


if __name__ == "__main__":
    main()
