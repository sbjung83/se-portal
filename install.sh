#!/bin/bash
# SE Portal 설치 스크립트 - Rocky Linux 9.7 전용
# 실행 위치: /opt/se-portal/install.sh
set -e

# ── 설정 ──────────────────────────────────────
APP_DIR="/opt/se-portal"
APP_USER="appuser"
SERVICE_NAME="se-portal"
PYTHON_BIN="python3.11"
NGINX_CONF="/etc/nginx/conf.d/se-portal.conf"

# ── OS 확인 ────────────────────────────────────
echo "======================================"
echo "  SE Portal 설치 - Rocky Linux 9.7"
echo "======================================"
echo ""

if ! grep -q "Rocky Linux 9" /etc/os-release 2>/dev/null; then
    echo "[경고] Rocky Linux 9 환경이 아닙니다."
    grep "PRETTY_NAME" /etc/os-release
    read -p "       계속 진행하시겠습니까? (y/N): " confirm
    [[ "$confirm" != "y" && "$confirm" != "Y" ]] && exit 1
fi

if [[ $EUID -ne 0 ]]; then
    echo "[오류] root 또는 sudo 권한으로 실행해주세요."
    exit 1
fi

# 실행 위치 확인 - 반드시 APP_DIR 안에서 실행해야 함
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$SCRIPT_DIR" != "$APP_DIR" ]]; then
    echo "[오류] 이 스크립트는 $APP_DIR 안에서 실행해야 합니다."
    echo "       현재 위치: $SCRIPT_DIR"
    echo "       실행 방법: cd $APP_DIR && sudo bash install.sh"
    exit 1
fi

# ── 1. 시스템 패키지 설치 ──────────────────────
echo "[1/7] 시스템 패키지 설치..."
dnf install -y epel-release
dnf install -y \
    python3.11 \
    python3.11-pip \
    nginx \
    policycoreutils-python-utils

echo "  Python 버전: $($PYTHON_BIN --version)"
echo "  Nginx 버전:  $(nginx -v 2>&1)"

# ── 2. 앱 유저 생성 ────────────────────────────
echo "[2/7] 앱 유저 생성..."
if id "$APP_USER" &>/dev/null; then
    echo "  유저 '$APP_USER' 이미 존재 - 건너뜀"
else
    useradd -r -s /sbin/nologin -d $APP_DIR $APP_USER
    echo "  유저 '$APP_USER' 생성 완료"
fi

# ── 3. 필수 디렉토리 생성 ──────────────────────
# 파일은 이미 APP_DIR에 있으므로 cp 불필요
# 앱 실행 중 생성되는 데이터 디렉토리만 준비
echo "[3/7] 데이터 디렉토리 생성..."
mkdir -p $APP_DIR/data
mkdir -p $APP_DIR/uploads
echo "  $APP_DIR/data 생성"
echo "  $APP_DIR/uploads 생성"

# ── 4. Python 가상환경 구성 ────────────────────
echo "[4/7] Python 가상환경 구성..."
$PYTHON_BIN -m venv $APP_DIR/venv
$APP_DIR/venv/bin/pip install --upgrade pip -q
$APP_DIR/venv/bin/pip install -r $APP_DIR/requirements.txt -q
$APP_DIR/venv/bin/pip install openpyxl -q
echo "  패키지 설치 완료"
$APP_DIR/venv/bin/pip list | grep -E "fastapi|uvicorn|sqlalchemy"

# ── 5. 권한 설정 ───────────────────────────────
echo "[5/7] 권한 설정..."
chown -R $APP_USER:$APP_USER $APP_DIR
chmod -R 750 $APP_DIR
chmod -R 770 $APP_DIR/data $APP_DIR/uploads
echo "  소유자: $APP_USER"

# ── 6. systemd 서비스 등록 ─────────────────────
echo "[6/7] systemd 서비스 등록..."
cp $APP_DIR/se-portal.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME
sleep 2

if systemctl is-active --quiet $SERVICE_NAME; then
    echo "  서비스 정상 실행 중"
else
    echo "[오류] 서비스 실행 실패. 로그 확인:"
    journalctl -u $SERVICE_NAME -n 20 --no-pager
    exit 1
fi

# ── 7. Nginx + SELinux + 방화벽 설정 ──────────
echo "[7/7] Nginx / SELinux / 방화벽 설정..."

# SELinux - Nginx → uvicorn 포트 연결 허용
setsebool -P httpd_can_network_connect 1
echo "  SELinux: httpd_can_network_connect 허용"

# SELinux 컨텍스트 - data, uploads 쓰기 허용
semanage fcontext -a -t httpd_sys_rw_content_t "$APP_DIR/uploads(/.*)?" 2>/dev/null || true
semanage fcontext -a -t httpd_sys_rw_content_t "$APP_DIR/data(/.*)?" 2>/dev/null || true
restorecon -Rv $APP_DIR/uploads $APP_DIR/data
echo "  SELinux 컨텍스트 설정 완료"

# Nginx 설정
cp $APP_DIR/se-portal.nginx.conf $NGINX_CONF
nginx -t

systemctl enable nginx
systemctl restart nginx
echo "  Nginx 설정 적용 완료"

# 방화벽
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-port=8000/tcp
    firewall-cmd --reload
    echo "  포트 80, 8000 오픈 완료"
else
    echo "  [경고] firewalld 미실행 - 방화벽 설정 건너뜀"
fi

# ── 완료 ──────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "======================================"
echo "  설치 완료!"
echo "======================================"
echo ""
echo "  접속 URL   : http://${SERVER_IP}"
echo "  직접 접속  : http://${SERVER_IP}:8000"
echo ""
echo "  상태 확인  : systemctl status $SERVICE_NAME"
echo "  로그 확인  : journalctl -u $SERVICE_NAME -f"
echo "  Nginx 로그 : tail -f /var/log/nginx/error.log"
echo ""
echo "  ※ Nginx 설정에서 server_name을 실제 IP로 변경하세요:"
echo "     vi $NGINX_CONF"
echo ""
