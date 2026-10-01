/// What to tell the user for a native `installApk` status string: "started",
/// "needs_permission" or "error:<message>" (anything else reads as a failure).
String updateInstallResultMessage(String status) {
  if (status == 'started') {
    return 'Installer opened - confirm the update on screen.';
  }
  // Also returned when NO settings page opened: a play-flavor build does not
  // declare REQUEST_INSTALL_PACKAGES, so the OS has nothing to grant.
  if (status == 'needs_permission') {
    return "Allow 'Install unknown apps' for ScreenSync in the settings "
        'page that just opened, come back and tap Update again. If no '
        'settings page opened, this build cannot install updates itself - '
        'update ScreenSync from Google Play or reinstall the sideload build.';
  }
  if (status.startsWith('error:')) {
    final why = status.substring('error:'.length).trim();
    return why.isEmpty
        ? 'Could not open the installer.'
        : 'Could not open the installer: $why';
  }
  return 'Could not open the installer.';
}
