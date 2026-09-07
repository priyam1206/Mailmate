import os
import json
import re
import requests
from typing import Dict, Any, Optional
from services.agent.models.base import BaseModel


class LMStudioModel(BaseModel):
    """LM Studio adapter with private-LAN remote-local fallback."""

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None, timeout: int = 35):
        self.base_url = (base_url or os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:2806/v1")).rstrip("/")
        self.remote_worker_url = os.getenv("MAILMATE_REMOTE_WORKER_URL", "http://100.114.2.88:5000/api/compute").strip().rstrip("/")
        self.worker_token = os.getenv("MAILMATE_WORKER_TOKEN", "").strip()
        self.model = model or os.getenv("LM_STUDIO_MODEL", "qwen/qwen3.5-4b")
        self.timeout = timeout
        self.last_provider = None

    @staticmethod
    def _completion_url(base_url: str, worker: bool = False) -> str:
        base = (base_url or "").rstrip("/")
        if worker:
            if base.endswith("/v1"):
                return f"{base}/chat/completions"
            return f"{base}/v1/chat/completions"
        return f"{base}/chat/completions"

    def _request_completion(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        errors = []
        try:
            res = requests.post(self._completion_url(self.base_url), json=payload, timeout=self.timeout)
            if res.ok:
                self.last_provider = "local_lm_studio"
                return res.json()
            errors.append(f"local LM Studio HTTP {res.status_code}")
        except Exception as exc:
            errors.append(f"local LM Studio unavailable: {exc}")

        if self.remote_worker_url:
            if not self.worker_token:
                errors.append("remote worker configured but MAILMATE_WORKER_TOKEN is missing")
            else:
                try:
                    res = requests.post(
                        self._completion_url(self.remote_worker_url, worker=True),
                        json=payload,
                        headers={"Authorization": f"Bearer {self.worker_token}"},
                        timeout=self.timeout,
                    )
                    if res.ok:
                        self.last_provider = "remote_local_worker"
                        return res.json()
                    errors.append(f"remote local worker HTTP {res.status_code}")
                except Exception as exc:
                    errors.append(f"remote local worker unavailable: {exc}")

        raise RuntimeError("; ".join(errors) or "No local model route is available.")

    def plan(self, goal: str, context: str, tools: Dict[str, Any], session: Any) -> Dict[str, Any]:
        tool_descriptions = "\n".join([f"- {name}: {t['description']}" for name, t in tools.items()])
        system_prompt = (
            "You are Mailmate's autonomous preparatory work agent runtime.\n"
            "You operate in a bounded loop: PLAN -> POLICY -> ACT -> OBSERVE -> VERIFY.\n"
            "Your goal is to prepare all required outputs (checklist, drafted reply, workspace files) for the user's review.\n"
            "You do NOT have permission to send emails or alter external calendars; only prepare them.\n\n"
            "Available tools:\n" + tool_descriptions + "\n\n"
            "Response Schema strictly matching JSON:\n"
            "{\n"
            '  "thought": "Reason about current state and what specific tool to use next",\n'
            '  "action": "tool_name",\n'
            '  "args": { "param1": "value1" }\n'
            "}\n"
            "When all preparations are done, call 'work.finish' with summary in args."
        )
        user_prompt = f"GOAL: {goal}\n\nCURRENT CONTEXT & STATE:\n{context}\n\nChoose the single next best action to advance this goal. Return valid JSON only."
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "max_tokens": 2500,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        }
        response_json = self._request_completion(payload)
        try:
            msg = response_json["choices"][0]["message"]
        except Exception as exc:
            raise ValueError(f"Invalid model response shape: {exc}")
        content = msg.get("content") or ""
        thought = msg.get("reasoning_content") or ""
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
        match = re.search(r"\{[\s\S]*\}", clean)
        if match:
            try:
                parsed = json.loads(match.group(0))
                if "action" in parsed:
                    if "thought" not in parsed and thought:
                        parsed["thought"] = thought[:250]
                    return parsed
            except Exception:
                pass
        if thought:
            clean_thought = re.sub(r"^```(?:json)?\s*|\s*```$", "", thought, flags=re.I)
            for match in re.finditer(r"\{[\s\S]*?\}", clean_thought):
                try:
                    parsed = json.loads(match.group(0))
                    if "action" in parsed:
                        return parsed
                except Exception:
                    pass
        raise ValueError("No structured action JSON found in model completion.")

