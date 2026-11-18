"""소프트웨어 라이선스 정책 — 쉬운 설명 기본 내용 (지식 창고 > 라이선스 정책, routers/licenses.py).

여기 글은 'lic_items' 표의 기본값이다. 화면에서 관리자가 고친 항목(edited)은 덮어쓰지 않는다.
sources 의 watch=True 주소는 하루 한 번 읽어 내용이 바뀌면 '변경 감지'로 표시한다 (내용을 자동으로 고치지는 않는다).
가격은 계약·리셀러·시점마다 달라서 넣지 않는다. 세는 방법·조건·예시만 쓴다.
"""

REVIEWED = "2026-11-19"   # 이 글을 공식 문서 기준으로 마지막으로 검토한 날

CATEGORIES = [
    ("basic", "기초 용어"),
    ("os", "운영체제"),
    ("virt", "가상화"),
    ("backup", "백업"),
    ("db", "데이터베이스"),
]

CAT_INTRO = {
    "basic": "라이선스 이야기에 자주 나오는 말을 먼저 정리했습니다. 다른 탭을 읽기 전에 한 번 보면 훨씬 쉽습니다.",
    "os": "서버 OS 는 **무료(리눅스 일부) / 구독(RHEL·Ubuntu Pro) / 코어 수만큼 구매(Windows Server·AIX)** 세 갈래로 나뉩니다.",
    "virt": "가상화는 대부분 **물리 서버의 CPU(소켓 또는 코어) 수**로 셉니다. 그 위에 올리는 VM 의 OS 라이선스는 **따로** 필요합니다.",
    "backup": "백업 소프트웨어는 **지키는 대상의 수(VM·서버 대수)** 또는 **지키는 데이터 양(TB)** 으로 셉니다.",
    "db": "DB 는 라이선스 위반 시 금액이 가장 큽니다. 특히 **가상화 위에서 돌릴 때** 세는 방법이 까다로우니 주의하세요.",
}

ITEMS = [
    # ───────────────────────── 기초 용어 ─────────────────────────
    {
        "key": "terms", "cat": "basic", "name": "꼭 알아야 할 라이선스 용어", "vendor": "",
        "summary": "영구 vs 구독, 소켓·코어, 최소 수량, CAL, 유지보수, 용량(TB) — 이것만 알면 대부분의 견적서를 읽을 수 있습니다.",
        "body": """## 영구 라이선스 vs 구독
| 구분 | 뜻 | 비유 |
|---|---|---|
| **영구(Perpetual)** | 한 번 사면 그 버전은 계속 사용. 업데이트·기술지원은 **유지보수 계약**을 따로 매년 냄 | 자동차를 사고, 정비 계약을 따로 맺음 |
| **구독(Subscription)** | 1년·3년 단위로 사용 권리를 빌림. **기간이 끝나면 사용 권리도 끝** | 자동차 장기 렌트 |

요즘은 많은 회사가 영구 판매를 끝내고 구독만 팝니다 (예: VMware, Veeam 신규, Commvault).

## 소켓 · 코어 · vCPU
- **소켓(Socket)** = 메인보드에 꽂힌 CPU 칩 1개. 2CPU 서버 = 2소켓.
- **코어(Core)** = CPU 칩 안의 계산 장치. 예) Xeon 16코어 CPU 2개 = 32코어.
- **vCPU** = VM 에 나눠 준 가상 CPU.
- 예전엔 소켓 단위가 많았지만, 지금은 **코어 단위**가 대세입니다. CPU 코어 수가 늘수록 비용도 늘어납니다.

## 최소 수량 (가장 많이 놓치는 부분)
"코어당 과금"이어도 **CPU 1개당 최소 몇 코어**는 무조건 사야 하는 경우가 많습니다.
- 예) Windows Server: CPU 당 최소 8코어, 서버당 최소 16코어 → 8코어 CPU 1개짜리 서버도 **16코어분**을 사야 함.
- 예) VMware: CPU 당 최소 16코어 → 12코어 CPU 2개 서버도 **32코어분**.

## CAL (Client Access License, 접속 라이선스)
서버 라이선스와 별도로, **서버에 접속하는 사용자나 장치 수만큼** 사야 하는 권리입니다. Windows Server, SQL Server(서버+CAL 방식)에 있습니다.
- 사용자 CAL: 사람 1명당 1개 (그 사람이 PC·노트북·폰 몇 대로 접속해도 1개)
- 장치 CAL: 기기 1대당 1개 (교대 근무로 여러 명이 한 PC 를 쓸 때 유리)

## 유지보수 / 기술지원 계약
영구 라이선스의 업데이트·새 버전·기술지원 권리입니다. 회사마다 이름이 다릅니다.
- Microsoft: **SA**(Software Assurance) · IBM: **SWMA**(Software Maintenance) · Oracle: **Support**(보통 라이선스 값의 연 22% 수준) · Veeam: **Support & Maintenance**
- 끊었다가 다시 가입하면 **밀린 기간 비용 + 벌금**을 요구하는 회사가 많습니다.

## 용량 기반 (백업 제품에서 많이 씀)
- **FETB(Front-End TB)** = 백업 **원본** 데이터 크기. 예) 지킬 DB 가 5TB → 5TB.
- **BETB(Back-End TB)** = 백업 **저장소에 실제로 쌓인** 크기(중복 제거·압축 후).
- 같은 환경이라도 어느 쪽으로 세느냐에 따라 숫자가 몇 배 차이 날 수 있습니다.

## 감사(Audit)
Microsoft·Oracle·IBM·Broadcom 등은 고객사 라이선스 사용 현황을 **감사**할 권리가 계약에 있습니다. 부족분이 나오면 정가 기준으로 소급 청구되므로, 증설·이전 작업 전에 라이선스를 꼭 확인하세요.
""",
        "sources": [],
    },

    # ───────────────────────── 운영체제 ─────────────────────────
    {
        "key": "windows-server", "cat": "os", "name": "Windows Server", "vendor": "Microsoft",
        "summary": "물리 서버의 **전체 코어 수**만큼 구매(CPU당 최소 8, 서버당 최소 16코어). Standard 는 VM 2개까지, Datacenter 는 VM 무제한. 접속자용 **CAL** 은 따로.",
        "body": """## 어떻게 세나요
1. 서버에 있는 **물리 코어 전부**를 셉니다 (켜 둔 코어 기준, 하이퍼스레딩은 세지 않음).
2. 단, **CPU 1개당 최소 8코어, 서버 1대당 최소 16코어**.
3. 2코어 팩 / 16코어 팩 단위로 삽니다.
4. 서버에 접속하는 사람(또는 장치) 수만큼 **Windows Server CAL** 도 삽니다. 원격 데스크톱으로 여러 명이 쓰면 **RDS CAL** 을 추가로.

## 에디션 차이
| 에디션 | 그 서버에서 돌릴 수 있는 Windows VM | 이럴 때 |
|---|---|---|
| **Standard** | **2개** (더 필요하면 서버 전체 코어만큼 **한 번 더** 삼) | 물리 서버 1대에 VM 몇 개 |
| **Datacenter** | **무제한** | 가상화 호스트에 Windows VM 이 많을 때 |
| Essentials | 소규모(사용자 25명·장치 50대, CPU 1개·최대 10코어까지), CAL 불필요 | 아주 작은 사무실 |

## 예시
- **16코어 서버 1대에 Windows VM 2개** → Standard 16코어. 끝.
- **같은 서버에 VM 4개** → Standard 16코어를 **2번**(32코어분).
- **32코어(16코어×2CPU) 가상화 호스트에 Windows VM 15개** → Standard 로는 32코어분을 8번 사야 하니, **Datacenter 32코어**가 훨씬 쌉니다. 16코어 호스트 기준으로 대략 VM 12개 이상이면 Datacenter 쪽이 유리합니다.
- **8코어 CPU 1개짜리 작은 서버** → 그래도 최소 **16코어분**.

## 주의할 점
- 라이선스는 **물리 서버(호스트)에 붙습니다.** VM 을 다른 호스트로 vMotion·라이브 마이그레이션하면, 옮겨 간 호스트에도 라이선스가 있어야 합니다 (클러스터라면 보통 **모든 호스트를 Datacenter** 로).
- VMware·Proxmox 위에 올려도 Windows 라이선스는 **똑같이** 이 규칙으로 셉니다.
- Windows Server 2025 부터 Azure Arc 를 통한 **사용한 만큼 월 과금(코어당)** 방식도 있습니다 (인터넷·Azure 연결 필요).
""",
        "sources": [
            ("Microsoft — Windows Server 2025 라이선스 안내", "https://www.microsoft.com/licensing/guidance/Windows-Server-2025", True),
            ("Microsoft Learn — Windows Server 에디션 비교", "https://learn.microsoft.com/en-us/windows-server/get-started/editions-comparison", True),
        ],
    },
    {
        "key": "rhel", "cat": "os", "name": "Red Hat Enterprise Linux (RHEL)", "vendor": "Red Hat",
        "summary": "OS 자체는 '구독'으로 씁니다. 물리 서버 **CPU 2개까지 1구독**, VM 은 **2대당 1구독**, VM 이 많으면 호스트 단위 **Virtual Datacenters**(VM 무제한).",
        "body": """## 어떻게 세나요
RHEL 은 **영구 라이선스가 없고 1년/3년 구독**입니다. 구독에는 업데이트·보안 패치·기술지원 권리가 들어 있습니다.

| 설치 위치 | 구독 1개로 되는 범위 |
|---|---|
| **물리 서버** | CPU **2소켓**까지 1대 (4소켓 서버 = 2구독) |
| **VM 몇 대** | VM **2대** (VM 5대 = 3구독) |
| **가상화 호스트 통째로** (*Virtual Datacenters*) | 호스트의 CPU **2소켓**당 1구독 → 그 호스트 위 RHEL VM **무제한** |

기술지원 수준(Standard: 평일 근무시간 / Premium: 24시간)에 따라 값이 다릅니다.

## 예시
- **물리 서버 2CPU 1대에 RHEL 설치** → 구독 1개.
- **VMware 호스트 2대(각 2CPU) 위에 RHEL VM 4대** → VM 단위로 구독 2개가 쌉니다.
- **같은 호스트 2대에 RHEL VM 20대** → VM 단위면 10개, Virtual Datacenters 면 호스트 2대분 2개. VM 이 대략 7~8대를 넘으면 Virtual Datacenters 가 유리합니다. 단, VM 이 옮겨 다닐 수 있는 **클러스터의 모든 호스트**에 구독이 있어야 합니다.

## 무료로 쓸 수 있나요
- 개인 개발자용 **Red Hat Developer Subscription for Individuals** 는 무료(소수 시스템, 운영 서비스 용도 아님).
- 회사 운영 서버를 무료로 쓰려면 RHEL 과 호환되는 **Rocky Linux** 등을 씁니다 (아래 항목).

## 주의할 점
- 구독이 끝나면 **업데이트·패치 저장소 접속이 막힙니다.** 설치된 OS 가 바로 꺼지지는 않지만, 보안 패치 없이 운영하는 것은 계약 위반 + 보안 위험입니다.
""",
        "sources": [
            ("Red Hat — RHEL 구독 가이드", "https://www.redhat.com/en/resources/red-hat-enterprise-linux-subscription-guide", True),
            ("Red Hat — 무료 개발자 구독 FAQ", "https://developers.redhat.com/articles/faqs-no-cost-red-hat-enterprise-linux", True),
        ],
    },
    {
        "key": "rocky", "cat": "os", "name": "Rocky Linux", "vendor": "Rocky Enterprise Software Foundation",
        "summary": "**완전 무료**(오픈소스). 대수·용도 제한 없이 운영 서버에도 쓸 수 있습니다. 기술지원이 필요하면 유료 지원 업체와 따로 계약.",
        "body": """## 어떻게 세나요
세지 않습니다. **라이선스 비용이 없습니다.** RHEL 과 같은 소스로 만든 호환 OS 라서 RHEL 용 프로그램 대부분이 그대로 돕니다.

## 예시
- 서버 100대에 설치해도 **0원**.
- 장애가 났을 때 전화할 곳이 필요하면 → CIQ 등 **상용 지원 업체**와 지원 계약(대수 기준)을 맺습니다. 이것은 '라이선스'가 아니라 '지원 서비스' 비용입니다.

## 주의할 점
- 그 위에서 돌리는 **상용 소프트웨어**(Oracle DB, 백업 에이전트 등)는 각 회사의 지원 OS 목록에 Rocky 가 있는지 확인하세요. "RHEL 만 지원"이라고 써 있으면 장애 때 지원을 거절당할 수 있습니다.
""",
        "sources": [
            ("Rocky Linux — 소개", "https://rockylinux.org/about", True),
        ],
    },
    {
        "key": "ubuntu", "cat": "os", "name": "Ubuntu (Ubuntu Pro)", "vendor": "Canonical",
        "summary": "OS 는 **무료**. 기본 5년 보안 패치 이후(최대 10년+)까지 받거나 기술지원이 필요하면 유료 **Ubuntu Pro**(서버 대수 기준 구독). 개인은 5대까지 Pro 무료.",
        "body": """## 어떻게 세나요
| 구분 | 비용 | 받는 것 |
|---|---|---|
| **Ubuntu (일반)** | 무료 | LTS 버전 기본 5년 보안 업데이트 |
| **Ubuntu Pro** | 서버(물리 또는 VM) **대수 기준** 연 구독 | 보안 패치 기간 연장(ESM, 총 10년 이상), 커널 무중단 패치(Livepatch), 보안 인증 도구 |
| Ubuntu Pro + Support | 위 + 기술지원 | 전화·티켓 기술지원 |

- **개인 사용자**는 Ubuntu Pro 를 **5대까지 무료**로 쓸 수 있습니다.
- 가상화 호스트 단위로 묶어 사는 상품도 있습니다 (VM 이 많을 때).

## 예시
- 사내 테스트 서버 3대 → 일반 Ubuntu 로 **0원**.
- 2020년에 설치한 **Ubuntu 20.04** 서버를 계속 써야 함 → 기본 보안 패치는 2025년에 끝났으므로 **Ubuntu Pro** 로 ESM 패치를 받거나 새 버전으로 올려야 합니다.

## 주의할 점
- "무료라서 신경 안 써도 된다"가 아니라, **버전별 보안 패치 종료일**(OS별 EOS 현황 메뉴 참고)을 챙겨야 합니다.
""",
        "sources": [
            ("Canonical — Ubuntu Pro 가격", "https://ubuntu.com/pricing/pro", True),
            ("Canonical — Ubuntu Pro 소개", "https://ubuntu.com/pro", True),
        ],
    },
    {
        "key": "aix", "cat": "os", "name": "IBM AIX", "vendor": "IBM",
        "summary": "IBM Power 서버에서 **사용하는 프로세서 코어 수**만큼 구매 + 매년 **SWMA**(유지보수). 서버 등급(소/중/대형)에 따라 코어 단가가 다릅니다.",
        "body": """## 어떻게 세나요
1. AIX 가 실제로 쓰는 **프로세서 코어 수**를 셉니다. Power 서버는 LPAR(논리 파티션)로 나눠 쓰므로, 보통 **AIX LPAR 들에 할당·활성화된 코어** 기준입니다.
2. 서버 모델의 **등급(Small / Medium / Large 등)** 에 따라 코어당 값이 다릅니다.
3. 첫 구매에 보통 1~3년 **SWMA**(Software Maintenance: 업데이트·기술지원)가 포함되고, 이후 매년 갱신합니다.
4. 영구 라이선스 외에 **기간 구독** 형태도 있습니다.

## 예시
- Power 서버 1대, 그중 AIX LPAR 2개에 각각 2코어·4코어 할당 → AIX **6코어** 분.
- 남는 코어를 Linux LPAR 에 주면 그 코어는 AIX 라이선스가 필요 없습니다(대신 Linux 쪽 구독).

## 주의할 점
- **SWMA 를 끊으면** 새 TL/SP(업데이트)를 받을 권리와 기술지원이 끊기고, 다시 붙일 때 **밀린 기간 비용(After-License)** 을 냅니다.
- 코어를 늘리는 작업(CoD 활성화, LPAR 코어 증설) 전에 AIX 라이선스 수를 확인하세요.
- 같은 서버의 PowerVM(가상화), PowerHA(이중화), HMC 등도 각각 별도 라이선스입니다.
""",
        "sources": [
            ("IBM — AIX 제품 페이지", "https://www.ibm.com/products/aix", True),
        ],
    },
    {
        "key": "hpux", "cat": "os", "name": "HPE HP-UX", "vendor": "HPE",
        "summary": "HPE Integrity(Itanium) 서버 전용. 서버를 살 때 **CPU(소켓·코어)** 단위로 **운영 환경(OE)** 라이선스를 함께 샀고, 지금은 신규 판매가 사실상 끝난 **유지 단계** 제품입니다.",
        "body": """## 어떻게 세나요
- HP-UX 11i v3 는 **운영 환경(OE, Operating Environment)** 묶음으로 팔렸고, 서버의 **CPU 수(소켓 또는 코어)** 만큼 샀습니다.
  - BOE(기본) / VSE-OE(가상화 포함) / HA-OE(이중화 Serviceguard 포함) / DC-OE(전부)
- 보통 **서버를 살 때 함께 구매**했고, 이후에는 HPE **지원 계약**(패치·기술지원)만 매년 갱신합니다.

## 예시
- Integrity 서버 2소켓, HA-OE → HA-OE **2소켓분** + 연간 지원 계약.

## 주의할 점
- Itanium CPU 와 HP-UX 는 **단종 수순**입니다. 버전·지원 종료일은 'OS별 EOS 현황'의 HP-UX 를 참고하고, 지원 계약이 끝나기 전에 Linux 등으로의 **전환 계획**을 세우는 것이 일반적입니다.
- HPE 사이트를 서버에서 자동으로 읽을 수 없어, 이 항목은 **변경 자동 감지 대상이 아닙니다**.
""",
        "sources": [],
    },

    # ───────────────────────── 가상화 ─────────────────────────
    {
        "key": "vmware", "cat": "virt", "name": "VMware vSphere / VCF", "vendor": "Broadcom",
        "summary": "2024년 Broadcom 인수 후 **영구 판매 종료 → 구독만**. 호스트의 **전체 코어 수**로 세고 **CPU당 최소 16코어**. 상품은 VCF·VVF 등 묶음 위주로 정리.",
        "body": """## 무엇이 바뀌었나 (2024년~)
| 예전 | 지금 |
|---|---|
| CPU(소켓) 단위, **영구** 라이선스 + 유지보수 | **코어 단위 구독**(1·3·5년) |
| vSphere Standard / Enterprise Plus 등 여러 개별 제품 | **VCF**(VMware Cloud Foundation, 전체 묶음)·**VVF**(vSphere Foundation) 등 묶음 위주 |
| 무료 ESXi | 2024년에 없앴다가 일부 버전으로 다시 제공(기능·지원 제한) |

## 어떻게 세나요
1. vSphere 를 설치한 **모든 호스트의 물리 코어 수**를 셉니다.
2. **CPU 1개당 최소 16코어.** 8코어 CPU 도 16코어로 계산.
3. vSAN 을 쓰면 **용량(TiB)** 을 따로 셉니다 (상품에 일부 포함).
4. 구독 기간 안에만 사용·업데이트 권리가 있습니다.

## 예시
- **호스트 3대, 각 16코어 CPU×2** → 3 × 32 = **96코어** 구독.
- **호스트 2대, 각 12코어 CPU×2** → 실제 24코어지만 CPU당 최소 16 → 2 × 32 = **64코어** 구독.
- **호스트 1대, 8코어 CPU 1개(작은 지사)** → 최소 16코어.

## 주의할 점
- 예전 영구 라이선스는 계속 쓸 수는 있지만, **유지보수가 끝나면 패치·새 버전을 받을 수 없습니다.** 갱신 시 구독으로 전환을 요구받습니다.
- 주문당 최소 수량(예: 72코어)이 있었다는 보도가 있으나 공식 문서 기준이 바뀌기도 해서, **견적 때 리셀러에게 서면으로 확인**하세요.
- **갱신을 늦게 하면 가산금**을 붙이는 정책이 보도되었습니다. 만료일을 미리 챙기세요.
- VM 안의 OS(Windows, RHEL 등) 라이선스는 **별도**입니다.
""",
        "sources": [
            ("Broadcom KB — VCF·VVF 코어·TiB 세는 방법", "https://knowledge.broadcom.com/external/article/313548", True),
            ("VMware — vSphere Foundation 제품 페이지", "https://www.vmware.com/products/cloud-infrastructure/vsphere-foundation", False),
        ],
    },
    {
        "key": "proxmox", "cat": "virt", "name": "Proxmox VE", "vendor": "Proxmox Server Solutions",
        "summary": "**소프트웨어는 무료**(오픈소스, 기능 제한 없음). 안정판 업데이트 저장소·기술지원을 원하면 **CPU 소켓당 연 구독**(Community/Basic/Standard/Premium).",
        "body": """## 어떻게 세나요
- 설치·사용은 **무료**이고 VM 수·호스트 수 제한도 없습니다.
- **구독**(선택)은 서버의 **물리 CPU 소켓 수** 기준, 1년 단위입니다. 코어 수·VM 수와는 관계없습니다.

| 구독 | 받는 것 |
|---|---|
| (구독 없음) | 'no-subscription' 저장소(최신이지만 덜 검증된 업데이트), 커뮤니티 포럼 |
| **Community** | **Enterprise 저장소**(검증된 안정판 업데이트) |
| **Basic / Standard** | 위 + 근무시간 기술지원 티켓(연 횟수 제한, 응답 시간 보장) |
| **Premium** | 위 + 무제한 티켓, 더 빠른 응답 |

## 예시
- **테스트용 호스트 1대** → 구독 없이 **0원**. 로그인할 때 "유효한 구독 없음" 안내 창이 뜨는 것은 정상입니다.
- **운영 클러스터 3대, 각 2소켓** → 6소켓분 구독. 클러스터의 **모든 노드를 같은 등급**으로 맞추는 것이 원칙입니다.

## 주의할 점
- 백업 서버(Proxmox Backup Server)는 **별도 제품·별도 구독**입니다.
- VM 안의 OS(Windows 등) 라이선스는 **별도**입니다. Windows VM 을 여러 개 돌리면 위 'Windows Server' 항목대로 호스트 코어 기준으로 삽니다.
""",
        "sources": [
            ("Proxmox — VE 구독 가격", "https://www.proxmox.com/en/products/proxmox-virtual-environment/pricing", True),
        ],
    },
    {
        "key": "hyperv", "cat": "virt", "name": "Microsoft Hyper-V", "vendor": "Microsoft",
        "summary": "Hyper-V 자체는 **Windows Server 에 포함**(추가 비용 없음). 실제로 돈이 드는 건 그 위 **Windows VM 의 라이선스** — 호스트를 Standard(VM 2개)나 Datacenter(무제한)로 삽니다.",
        "body": """## 어떻게 세나요
- Hyper-V 는 Windows Server 의 **기능(역할)** 입니다. Hyper-V 를 켠다고 추가 비용이 생기지 않습니다.
- 호스트에 **Windows Server 라이선스**(코어 기준)를 사면, 에디션에 따라 그 위 **Windows VM 수**가 정해집니다.
  - Standard: Windows VM 2개 / Datacenter: 무제한 (자세한 내용은 '운영체제 → Windows Server')
- Linux VM 만 돌린다면 Windows VM 권리는 필요 없지만, **호스트 OS 자체**의 Windows Server 라이선스(최소 16코어)는 필요합니다.
- 예전 무료 단독 제품 **Hyper-V Server** 는 2019 가 마지막입니다(이후 버전 없음).
- 클러스터·하이퍼컨버지드용 **Azure Local**(옛 Azure Stack HCI)은 코어당 **월 구독**이라 방식이 다릅니다.

## 예시
- **32코어 호스트 2대 클러스터, Windows VM 30개** → 두 호스트 모두 **Datacenter 32코어** (VM 이 어느 호스트로 옮겨 가도 무제한).
- **16코어 호스트 1대, Windows VM 2개 + Linux VM 5개** → **Standard 16코어** 하나면 됩니다.

## 주의할 점
- VM 을 다른 호스트로 옮기면(라이브 마이그레이션) **옮겨 간 호스트**도 그 VM 을 돌릴 권리가 있어야 합니다.
""",
        "sources": [
            ("Microsoft Learn — Hyper-V 개요", "https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/hyper-v-overview", True),
            ("Microsoft — Azure Local 가격", "https://azure.microsoft.com/en-us/pricing/details/azure-local/", True),
            ("Microsoft — Windows Server 2025 라이선스 안내", "https://www.microsoft.com/licensing/guidance/Windows-Server-2025", False),
        ],
    },

    # ───────────────────────── 백업 ─────────────────────────
    {
        "key": "veeam", "cat": "backup", "name": "Veeam Backup & Replication / Data Platform", "vendor": "Veeam",
        "summary": "지금은 **VUL(인스턴스) 구독**이 기본: 백업하는 **VM·서버 1대 = 1인스턴스**. 예전 CPU 소켓 영구 라이선스는 신규 판매 종료(기존 고객 갱신만). 소규모는 무료 Community Edition.",
        "body": """## 어떻게 세나요 — VUL(Veeam Universal License)
**백업하는 대상 하나하나**를 '인스턴스'로 셉니다. 대상 종류에 따라 소모량이 다릅니다.

| 백업 대상 | 소모 |
|---|---|
| VM 1대 (VMware·Hyper-V·Proxmox 등) | 1 인스턴스 |
| 물리 서버 1대 (Windows·Linux) | 1 인스턴스 |
| 업무용 PC 여러 대 | 몇 대당 1 인스턴스 (PC 는 더 적게 소모) |
| 파일 서버·NAS 공유 데이터 | 용량 단위로 인스턴스 소모 (예: 500GB 당 1) |

- Microsoft 365(메일·OneDrive)는 **사용자 수 기준 별도 제품**입니다.
- 묶음(에디션): Foundation → Advanced → Premium 순으로 기능이 늘어납니다(보안·랜섬웨어 대응·자동 복구 테스트 등).

## 예시
- **VM 40대 + 물리 서버 5대 백업** → **45 인스턴스** (보통 10개 묶음 단위로 구매 → 50).
- 호스트가 몇 대든, CPU 가 몇 개든 상관없이 **백업 대상 수**만 봅니다.

## 예전 방식(소켓)과의 차이
- 예전: VM 이 올라간 **호스트의 CPU 소켓 수**로 영구 구매 → VM 을 아무리 늘려도 비용 동일.
- 지금: 신규는 판매하지 않고, 기존 소켓 고객은 유지보수 갱신 또는 VUL 로 전환 권유를 받습니다.

## 무료로 쓸 수 있나요
- **Community Edition**: 소수 대상(작은 규모)까지 무료. 기술지원 없음. 테스트·소규모용.

## 주의할 점
- 백업 대상 수가 계약보다 많아지면 그 이후 대상은 백업이 안 되거나 경고가 뜹니다. **VM 을 늘릴 때 인스턴스 여유분**을 확인하세요.
""",
        "sources": [
            ("Veeam — 라이선스 정책", "https://www.veeam.com/licensing-policy.html", True),
            ("Veeam — 무료 Community Edition", "https://www.veeam.com/products/free/backup-recovery.html", True),
        ],
    },
    {
        "key": "tsm", "cat": "backup", "name": "IBM Storage Protect (구 TSM / Spectrum Protect)", "vendor": "IBM",
        "summary": "두 가지 방식: 백업하는 서버의 **CPU 성능 단위(PVU)** 로 세거나, **저장된 데이터 용량(TB)** 으로 셉니다. 요즘은 용량 방식(Suite)과 구독이 많습니다.",
        "body": """## 이름부터
TSM(Tivoli Storage Manager) → Spectrum Protect → **IBM Storage Protect** 로 이름만 바뀐 같은 제품입니다.

## 어떻게 세나요 — 두 가지 중 하나
| 방식 | 세는 것 | 이럴 때 유리 |
|---|---|---|
| **PVU 방식** (프로세서 가치 단위) | 백업 **클라이언트(서버)의 CPU 코어 수 × 코어당 점수(PVU)** | 서버 수는 적고 데이터가 많을 때 |
| **용량 방식** (Storage Protect **Suite**) | 백업 저장소에 **실제로 쌓인 데이터 TB** (중복 제거·압축 후, Back-End TB) | 서버가 많고 중복 제거가 잘 될 때 |

- PVU 점수는 CPU 종류마다 다릅니다(예: x86 코어 하나는 보통 70 PVU 수준, Power 는 더 높음). IBM 의 PVU 표를 봅니다.
- 같은 백업 서버 안에서 두 방식을 섞지 않는 것이 일반적입니다.

## 예시
- **PVU**: 백업 대상 x86 서버 10대, 각 16코어 → 10 × 16 × 70 = **11,200 PVU**.
- **용량**: 원본 100TB 를 백업하지만 중복 제거 후 저장소에 40TB → **40TB** 분.

## 주의할 점
- 매년 **SWMA**(유지보수) 갱신. 끊었다 다시 붙이면 밀린 비용이 붙습니다.
- 용량 방식은 **보관 기간을 늘리면 TB 가 늘어 비용도 늘어납니다.** 보관 정책 변경 전에 확인하세요.
- IBM 은 백업 제품을 **Storage Defender**(통합 구독) 쪽으로 옮기는 중이라, 갱신 때 전환 제안을 받을 수 있습니다.
""",
        "sources": [
            ("IBM — Storage Protect 제품 페이지", "https://www.ibm.com/products/storage-protect", True),
            ("IBM Support — Storage Protect Suite 정보", "https://www.ibm.com/support/pages/node/607977", True),
        ],
    },
    {
        "key": "commvault", "cat": "backup", "name": "Commvault", "vendor": "Commvault",
        "summary": "**지키는 원본 용량(Front-End TB)** 또는 **VM·인스턴스 수**로 셉니다. 현재 신규는 주로 구독. 한 백업 환경(CommCell) 안에서는 한 방식만.",
        "body": """## 어떻게 세나요 — 두 가지 중 하나
| 방식 | 세는 것 |
|---|---|
| **용량(FETB)** | 백업하는 **원본 데이터의 크기**. 중복 제거·압축 **전** 기준. |
| **VM·인스턴스** | 백업하는 **VM·서버·DB 인스턴스 수** |

- 한 백업 환경(CommCell) 안에서는 보통 **한 방식만** 씁니다.
- 기능 묶음(보관·복제·클라우드 등)과 추가 기능에 따라 단가가 달라집니다.
- 하드웨어 일체형 **HyperScale** 은 장비 용량(TB) 단위 구독으로 따로 팝니다.

## 예시
- 원본 DB 5TB + 파일 서버 15TB 를 매일 백업 → **20 FETB** (백업 저장소에 쌓인 양과 무관).
- 작은 VM 이 아주 많은 환경(VM 200대, 각 100GB) → 용량은 20TB, VM 은 200대. 어느 쪽이 싼지 **두 방식으로 견적**을 받아 비교합니다.

## 주의할 점
- FETB 는 **원본이 커지면 자동으로 늘어납니다.** 데이터가 빨리 느는 시스템은 갱신 때 비용이 크게 오를 수 있습니다.
- 구독 기간이 끝나면 백업 실행이 막힐 수 있습니다(복구는 일정 기간 허용되는 경우가 많음). 만료일을 꼭 관리하세요.
""",
        "sources": [
            ("Commvault — 라이선스 가이드(PDF)", "https://documentation.commvault.com/11.44/software/files/pdf/commvault-complete-license-guide.pdf", True),
        ],
    },

    # ───────────────────────── DB ─────────────────────────
    {
        "key": "oracle-db", "cat": "db", "name": "Oracle Database", "vendor": "Oracle",
        "summary": "**프로세서(코어 × 코어 계수)** 또는 **사용자 수(NUP)** 로 셉니다. VMware 같은 가상화 위에 올리면 **VM 이 아니라 클러스터 전체 물리 코어**를 요구받을 수 있어 가장 조심해야 합니다.",
        "body": """## 에디션
| 에디션 | 쓸 수 있는 서버 | 세는 법 |
|---|---|---|
| **Standard Edition 2 (SE2)** | CPU **2소켓 이하** 서버만 | **소켓** 1개 = 1 프로세서 |
| **Enterprise Edition (EE)** | 제한 없음 | **코어 수 × 코어 계수** |

## 어떻게 세나요 — 두 가지 중 하나
1. **프로세서 방식** (사용자 수를 셀 수 없을 때, 웹 서비스 등)
   - EE: 물리 코어 수 × **코어 계수** (Intel·AMD = 0.5, IBM Power = 1.0 등, Oracle 코어 계수 표)
   - 예) Intel 16코어 CPU 2개 = 32코어 × 0.5 = **16 프로세서**
2. **NUP 방식** (Named User Plus, 실제 사용자·장치 수)
   - EE 는 **프로세서당 최소 25 NUP**, SE2 는 **서버당 최소 10 NUP**
   - 예) 위 서버(16 프로세서)에 사용자 30명 → 최소 16 × 25 = **400 NUP** 를 사야 함 (30명이 아니라!)

## 가상화 위에서 (가장 큰 위험)
- Oracle 은 VMware·Hyper-V·Proxmox 같은 가상화를 **"소프트 파티셔닝"** 이라 보고, VM 에 준 vCPU 가 아니라 **그 VM 이 돌 수 있는 모든 호스트의 물리 코어 전체**를 요구하는 입장입니다.
  - 예) VMware 호스트 5대 클러스터(각 32코어)에 Oracle VM **1대(4vCPU)** → Oracle 해석상 5 × 32 × 0.5 = **80 프로세서** 를 요구받을 수 있음.
- 그래서 보통 **Oracle 전용 호스트(클러스터)** 를 따로 두거나, Oracle 이 인정하는 **하드 파티셔닝**(IBM Power 의 LPAR, Oracle VM/OLVM 고정 할당 등)을 씁니다.

## 주의할 점
- 연 **기술지원(Support)** 은 라이선스 값의 약 22%. 끊으면 패치를 못 받고, 재가입 시 밀린 비용을 냅니다.
- RAC(이중화), Partitioning, Diagnostics/Tuning Pack 같은 **옵션은 EE 위에 따로 구매**입니다. 설치만 되어 있어도 '사용'으로 잡힐 수 있으니 안 쓰는 옵션은 끄세요.
- Oracle 은 **라이선스 감사**가 잦습니다.
""",
        "sources": [
            ("Oracle — 파티셔닝(가상화) 정책 PDF", "https://www.oracle.com/us/corporate/pricing/partitioning-070609.pdf", True),
            ("Oracle — 프로세서 코어 계수 표 PDF", "https://www.oracle.com/us/corporate/contracts/processor-core-factor-table-070634.pdf", True),
            ("Oracle Docs — Database 라이선스 정보", "https://docs.oracle.com/en/database/oracle/oracle-database/23/dblic/Licensing-Information.html", True),
        ],
    },
    {
        "key": "mssql", "cat": "db", "name": "Microsoft SQL Server", "vendor": "Microsoft",
        "summary": "**코어 방식**(CPU당·VM당 최소 4코어) 또는 Standard 만 **서버 + CAL** 방식. VM 단위로 살 수 있어 Oracle 보다 가상화에 관대. 개발용 Developer·소형 Express 는 무료.",
        "body": """## 에디션
| 에디션 | 세는 법 | 비고 |
|---|---|---|
| **Enterprise** | 코어 방식만 | 큰 규모, 기능 전부 |
| **Standard** | 코어 방식 **또는** 서버 + CAL | 사용할 수 있는 코어·메모리에 상한 있음 (버전마다 다름, 2025 버전에서 상향) |
| **Developer** | 무료 | **개발·테스트 전용**(운영 금지) |
| **Express** | 무료 | DB 크기 등 제한, 소형 프로그램용 |

## 어떻게 세나요
**코어 방식**
- **물리 서버**: 물리 코어 전부, 단 **CPU 1개당 최소 4코어**.
- **VM**: VM 에 준 **vCPU 수**, 단 **VM 1개당 최소 4코어**.
- 2코어 팩 단위로 삽니다. 사용자 수는 세지 않습니다(CAL 불필요).

**서버 + CAL 방식** (Standard 만)
- SQL 서버(또는 VM) 1개당 서버 라이선스 1개 + 접속하는 **사용자/장치 수만큼 SQL CAL**.
- 사용자 수가 적고 정해진 사내 시스템에 유리.

## 예시
- **VM 1개(2vCPU)에 Standard** → 최소 4코어 = **Standard 4코어**.
- **물리 서버 16코어×2CPU 에 Enterprise** → **32코어**.
- **사내 시스템, 사용자 20명, VM 1개** → Standard 서버 라이선스 1 + SQL CAL 20.
- **VM 이 많을 때** → 호스트의 물리 코어 전부를 Enterprise + **SA(유지보수)** 로 사면 그 호스트 위 SQL VM 을 **무제한**으로 돌릴 수 있습니다.

## 주의할 점
- 웹 서비스처럼 **사용자 수를 셀 수 없으면** 서버 + CAL 은 못 쓰고 코어 방식이어야 합니다.
- VM 을 다른 호스트로 자주 옮기는 환경(90일 안에 재할당)은 **SA** 가 있어야 자유롭습니다.
- 운영 DB 를 Developer 에디션으로 돌리는 것은 위반입니다.
""",
        "sources": [
            ("Microsoft — SQL Server 라이선스 안내", "https://www.microsoft.com/licensing/guidance/sql", True),
            ("Microsoft Learn — SQL Server 2025 에디션·기능", "https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025", True),
        ],
    },
]
