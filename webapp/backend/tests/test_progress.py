from app.worker.progress import compute_progress


def test_single_model_mid_segment():
    frac, stage = compute_progress(
        {"model_idx_in_bag": 0, "models": 1, "shift_idx": 0,
         "segment_offset": 5, "audio_length": 10, "state": "start"}
    )
    assert 0.49 <= frac <= 0.51
    assert stage == "model 1/1"


def test_bag_of_four_second_model():
    frac, _ = compute_progress(
        {"model_idx_in_bag": 1, "models": 4, "shift_idx": 0,
         "segment_offset": 0, "audio_length": 10, "state": "start"}
    )
    assert 0.24 <= frac <= 0.26  # 1/4 done


def test_clamped_and_safe_zero_length():
    frac, _ = compute_progress(
        {"model_idx_in_bag": 0, "models": 1, "shift_idx": 0,
         "segment_offset": 10, "audio_length": 0, "state": "end"}
    )
    assert frac == 0.0