#!/bin/bash

# Script kiểm tra số sao (stars) của các repository trên GitHub.
# Script này tự động đọc danh sách repository từ file sync_refs.sh.

SYNC_SCRIPT="sync_refs.sh"

if [ ! -f "$SYNC_SCRIPT" ]; then
  echo "❌ Không tìm thấy file $SYNC_SCRIPT!"
  exit 1
fi

echo "🔍 Đang đọc danh sách các repository từ $SYNC_SCRIPT..."

# Trích xuất các dòng định nghĩa repository dạng "dir|url" từ sync_refs.sh
REPOS=$(grep -E '"[a-zA-Z0-9_-]+\|https://github.com/[^"]+"' "$SYNC_SCRIPT" | sed -E 's/[[:space:]]*"([^"]+)".*/\1/')

if [ -z "$REPOS" ]; then
  echo "❌ Không tìm thấy repository nào trong $SYNC_SCRIPT."
  exit 1
fi

echo "📊 Đang truy vấn GitHub API để lấy số sao..."
echo ""
printf "%-30s | %-10s\n" "Repository Name" "Stars"
printf "%-30s-|-%-10s\n" "------------------------------" "----------"

# Cấu hình Authorization Header nếu có biến môi trường GITHUB_TOKEN
# (Giúp tránh giới hạn lượt gọi API của GitHub: 60 req/hour đối với unauthenticated)
AUTH_HEADER=()
if [ -n "$GITHUB_TOKEN" ]; then
  AUTH_HEADER=(-H "Authorization: token $GITHUB_TOKEN")
fi

for item in $REPOS; do
  DIR_NAME="${item%%|*}"
  REPO_URL="${item#*|}"
  
  # Chuyển đổi github link sang API path:
  # Ví dụ: https://github.com/agiresearch/A-mem.git -> agiresearch/A-mem
  REPO_PATH=$(echo "$REPO_URL" | sed -E 's|https://github.com/||' | sed -E 's|\.git$||')
  
  # Gọi API GitHub
  RESPONSE=$(curl -s "${AUTH_HEADER[@]}" "https://api.github.com/repos/$REPO_PATH")
  
  # Trích xuất số stars
  if command -v jq >/dev/null 2>&1; then
    STARS=$(echo "$RESPONSE" | jq '.stargazers_count' 2>/dev/null)
  else
    STARS=$(echo "$RESPONSE" | grep -o '"stargazers_count": [0-9]*' | head -n1 | cut -d' ' -f2)
  fi
  
  # Xử lý lỗi API (ví dụ: bị giới hạn rate limit hoặc repo private/sai link)
  if [ -z "$STARS" ] || [ "$STARS" = "null" ]; then
    MESSAGE=$(echo "$RESPONSE" | grep -o '"message": "[^"]*"' | head -n1 | cut -d'"' -f4)
    if [[ "$MESSAGE" == *"rate limit"* ]]; then
      STARS="Rate Limit"
    else
      STARS="N/A/Error"
    fi
  fi
  
  printf "%-30s | %-10s\n" "$DIR_NAME" "$STARS"
done
