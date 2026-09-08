from pathlib import Path
from types import SimpleNamespace
import sys

import services.whisper_service as whisper_module


ROOT = Path(__file__).resolve().parent.parent


def test_whisper_has_portable_cpu_and_gpu_profiles():
    source = (ROOT / 'services' / 'whisper_service.py').read_text(encoding='utf-8')

    assert "WHISPER_GPU_MODEL', 'small'" in source
    assert "WHISPER_CPU_MODEL', 'base.en'" in source
    assert "self.device, self.compute_type = 'cpu', 'int8'" in source
    assert 'cpu_threads=self.cpu_threads' in source
    assert 'language=self.language' in source
    assert 'vad_filter=True' in source


def test_cpu_only_machine_selects_lightweight_int8_model(monkeypatch, tmp_path):
    created = []
    monkeypatch.delenv('WHISPER_MODEL', raising=False)
    monkeypatch.setenv('WHISPER_CPU_MODEL', 'base.en')
    monkeypatch.setitem(sys.modules, 'ctranslate2', SimpleNamespace(get_cuda_device_count=lambda: 0))
    monkeypatch.setattr(
        whisper_module,
        'WhisperModel',
        lambda name, **kwargs: created.append((name, kwargs)) or object(),
    )
    service = whisper_module.WhisperService(model_dir=str(tmp_path))
    service._warm_model = lambda: setattr(service, 'warmed', True)

    service._load_model_background()

    assert created[0][0] == 'base.en'
    assert created[0][1]['device'] == 'cpu'
    assert created[0][1]['compute_type'] == 'int8'
    assert service.is_ready is True


def test_failed_cuda_load_falls_back_to_cpu_profile(monkeypatch, tmp_path):
    created = []
    monkeypatch.delenv('WHISPER_MODEL', raising=False)
    monkeypatch.setitem(sys.modules, 'ctranslate2', SimpleNamespace(get_cuda_device_count=lambda: 1))

    def fake_model(name, **kwargs):
        created.append((name, kwargs))
        if kwargs['device'] == 'cuda':
            raise RuntimeError('CUDA unavailable')
        return object()

    monkeypatch.setattr(whisper_module, 'WhisperModel', fake_model)
    service = whisper_module.WhisperService(model_dir=str(tmp_path))
    service._warm_model = lambda: setattr(service, 'warmed', True)

    service._load_model_background()

    assert created[0][0] == 'small'
    assert created[1][0] == 'base.en'
    assert created[1][1]['compute_type'] == 'int8'
    assert service.is_ready is True
