#!/usr/bin/env bash

set -euo pipefail

USER_NAME="ubuntu"
USER_HOME="/home/ubuntu"
SYSTEMD_SYSTEM_DIR="/etc/systemd/system"
SYSTEMD_USER_DIR="${USER_HOME}/.config/systemd/user"
ENV_FILE="${USER_HOME}/nanoclaw/.env"
VNC_PASSWD="${USER_HOME}/.vnc/passwd"
XRUNTIME_DIR="/run/user/1000"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

${SUDO} apt-get update
${SUDO} apt-get install -y \
  ca-certificates \
  curl \
  dbus-x11 \
  gpg \
  x11vnc \
  xserver-xorg-video-dummy \
  xfce4 \
  xfce4-goodies \
  xvfb

${SUDO} install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/google-chrome.gpg ]]; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | ${SUDO} gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
fi

${SUDO} tee /etc/apt/sources.list.d/google-chrome.list > /dev/null << 'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main
EOF

${SUDO} apt-get update
${SUDO} apt-get install -y google-chrome-stable

${SUDO} install -m 0644 scripts/systemd/persistent-desktop.service "${SYSTEMD_SYSTEM_DIR}/persistent-desktop.service"
${SUDO} install -m 0644 scripts/systemd/xfce-desktop.service "${SYSTEMD_SYSTEM_DIR}/xfce-desktop.service"
${SUDO} install -m 0644 scripts/systemd/x11vnc.service "${SYSTEMD_SYSTEM_DIR}/x11vnc.service"

${SUDO} -u "${USER_NAME}" mkdir -p "${SYSTEMD_USER_DIR}"
${SUDO} -u "${USER_NAME}" install -m 0644 scripts/systemd/chrome-cdp.service "${SYSTEMD_USER_DIR}/chrome-cdp.service"
${SUDO} -u "${USER_NAME}" install -m 0644 scripts/systemd/nanoclaw.service "${SYSTEMD_USER_DIR}/nanoclaw.service"

${SUDO} install -d -m 0700 -o "${USER_NAME}" -g "${USER_NAME}" "${XRUNTIME_DIR}"
${SUDO} -u "${USER_NAME}" mkdir -p "${USER_HOME}/.vnc"

if [[ ! -f "${ENV_FILE}" ]]; then
  ${SUDO} -u "${USER_NAME}" touch "${ENV_FILE}"
  echo "Warning: ${ENV_FILE} created empty. Add your secrets before starting nanoclaw." >&2
fi

if [[ ! -f "${VNC_PASSWD}" ]]; then
  echo "Warning: ${VNC_PASSWD} missing. Run 'vncpasswd' to set a VNC password." >&2
fi

${SUDO} loginctl enable-linger "${USER_NAME}"

${SUDO} systemctl daemon-reload
${SUDO} systemctl enable --now persistent-desktop.service xfce-desktop.service x11vnc.service

${SUDO} -u "${USER_NAME}" XDG_RUNTIME_DIR="${XRUNTIME_DIR}" systemctl --user daemon-reload
${SUDO} -u "${USER_NAME}" XDG_RUNTIME_DIR="${XRUNTIME_DIR}" systemctl --user enable --now chrome-cdp.service nanoclaw.service

echo "Setup complete."
