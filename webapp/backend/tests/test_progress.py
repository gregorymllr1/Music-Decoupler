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


def test_shift_passes_advance_fraction():
    # bag of 4, 2 shifts: model 0, second shift pass, halfway through audio
    frac, stage = compute_progress(
        {"model_idx_in_bag": 0, "models": 4, "shift_idx": 1,
         "segment_offset": 5, "audio_length": 10, "state": "end"},
        total_shifts=2,
    )
    # (0*2 + 1 + 0.5) / (4*2) = 0.1875
    assert 0.18 <= frac <= 0.20
    assert stage == "model 1/4"


def test_shift_fraction_monotonic_across_bag():
    def frac_at(model_idx, shift_idx, seg):
        f, _ = compute_progress(
            {"model_idx_in_bag": model_idx, "models": 4, "shift_idx": shift_idx,
             "segment_offset": seg, "audio_length": 10, "state": "end"},
            total_shifts=2,
        )
        return f

    seq = [frac_at(m, s, seg) for m in range(4) for s in range(2) for seg in (0, 5, 10)]
    assert seq == sorted(seq)
    assert seq[-1] == 1.0


def test_default_total_shifts_matches_legacy_behavior():
    d = {"model_idx_in_bag": 1, "models": 4, "shift_idx": 0,
         "segment_offset": 0, "audio_length": 10, "state": "end"}
    frac, _ = compute_progress(d)
    assert 0.24 <= frac <= 0.26