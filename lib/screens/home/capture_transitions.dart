import '../../blocs/screen_capture_bloc.dart';

/// What the home screen should do in response to one bloc emission.
typedef CaptureReaction = ({bool celebrate, bool showError});

/// Turns bloc VALUES into one-shot reactions.
///
/// `status` stays `success` after a capture and is only reset by the next one,
/// so reacting to the value re-celebrated on every unrelated hub/live flip and
/// let a later `errorMessage` (for example a refused live-mirror consent
/// prompt) be swallowed by the celebration branch. This reacts to transitions:
///  * celebrate when the status BECOMES success;
///  * show an error when the message changed, or the status BECAME failure (so
///    the same failure twice in a row is still told twice).
class CaptureTransitions {
  CaptureStatus? _status;
  String? _error;

  CaptureReaction observe(ScreenCaptureState state) {
    final becameSuccess =
        state.status == CaptureStatus.success && _status != CaptureStatus.success;
    final becameFailure =
        state.status == CaptureStatus.failure && _status != CaptureStatus.failure;
    final newError = state.errorMessage != null &&
        (state.errorMessage != _error || becameFailure);
    _status = state.status;
    _error = state.errorMessage;
    return (celebrate: becameSuccess, showError: newError);
  }
}
