# C2 认证主机受控通道契约与证据

## 当前实际结论

代码/R1限定复审通过，真实通道 PARTIAL：auth.openai.com 在本环境解析为 198.18.0.79，被公网IP策略正确拒绝；TLS/登录未完成，模型0/1。下面末节记录最终运行证据，初始失败历史不删除。

进度唯一入口：`plans/TASKS.md`。本轮复用用户对 EV 专属容器/认证存储、本人官方登录及安全通过后最多一次合成模型请求的授权；C2 不调用模型（0/1）。不复制桌面 auth，不接触项目/健康数据，不提交推送，不安装宿主依赖。

## 冻结的小契约

1. Codex 客户端保持 `network=none`、UID/GID65532、只读根、cap-drop ALL、no-new-privileges、有界内存/pids/tmpfs。受信任的同容器 loopback bridge 将代理字节转至 `/run/ev-auth/gateway.sock`。客户端只读挂载新 EV socket volume，不挂宿主目录。
2. 独立受信任 Python gateway 容器使用 bridge 网络，只监听 AF_UNIX，不发布端口，不挂认证/项目/Docker socket。固定只接受 `CONNECT auth.openai.com:443 HTTP/1.1` 或 HTTP/1.0；拒绝其他方法、目标、端口、歧义/畸形头。解析固定域名后只连接已验证的全局可路由 IP，禁止二次域名解析；失败关闭。
3. 认证隧道保留 CLI 到官方服务的端到端 TLS 和默认 CA 校验，不 MITM、不关闭证书验证。CONNECT 限制的是主机，不检查加密路径；不得声称协议层仅允许登录。
4. 头最多8KiB，连接最多8个，连接/空闲期限10/30秒、单隧道最长600秒、转发字节最多4MiB。进程存活最多600秒；bridge/gateway均有界，不记录头、隧道内容、tokens、设备码。拒绝只记录固定类别，不打印任意输入。
5. 新 EV 认证 named volume 挂载 `/home/ev-codex`，UID/GID65532、mode0700；仅客户端可见，官方 CLI 以 `cli_auth_credentials_store=file` 写入。登录模式只允许官方 `login --device-auth`，不得调用 exec/模型。登录输出只用于向用户呈现官方操作信息，不持久写入诊断文件或 Docker 日志（登录容器 log-driver=none）。官方流程若要求其他域名，停止，不自动扩白名单。
6. 先完成离线一条组合测试（正确CONNECT成功，非法目标/方法不产生上游连接、私网DNS拒绝），再实际无凭据探针：loopback→Unix→允许主机 TLS证书验证成功、直连失败、非法目标拒绝、网关停止后关闭。确认 inspect 的 mount/network边界，再启动一次登录。未配置/失败如实记录，不切换 API key。
7. 实施仅 `scripts/codex-container` 中新增 gateway/client/test 三脚本，并修改 Dockerfile/.dockerignore（五文件）。复用当前固定镜像构建基础，不重下载 Codex；复制新脚本置于现有下载层之后。主维护文档，Terra Max 实现，Astra medium 限定复核，初次实现加最多两轮局部修正。不增加业务功能或重新设计模型网关。

官方依据：[认证](https://learn.chatgpt.com/docs/auth)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。实际0.146.0容器 `login --help` exit0，支持 `--device-auth`；help不证明代理兼容或账号授权成功。

## 初始聚焦核对

Astra medium Epicurus `01a0a992-1c31-78c2-ae4c-8c150b0b7231`：方案条件可行；需验证真实代理兼容/域名范围、只读 socket 挂载、确切IP连接、TLS、gateway关闭后失败。共享UID的bridge属于受信任代码，CONNECT主机限制不是路径级权限，gateway仍是具有联网能力的受信任组件。尚未代码审查或运行验证。

## 结果

实施中，不代表真实接通。Terra Max Aquinas `01a0a993-ed3b-7671-9ddf-3003ca0e2899` 负责五文件；主同步处理隔离运行准备。

- 主在 C1 镜像的无网络/非root/只读容器里检查 Python默认TLS：check_hostname=True，verify_mode=2（CERT_REQUIRED），CA文件存在、150个CA；exit0。只验证本机CA配置，没有发起TLS连接。
- 核对同名前缀资源不存在后创建专属 `ev-codex-auth-20260916` bridge网络及 `ev-codex-auth-transport-20260916` named volume，均标记 ev.component=codex/ev.purpose=c2-auth（卷为c2-auth-transport），命令exit0。网络仅供受信任网关；CLI仍network none。尚无认证卷、无登录、无模型调用。

- C2 首次主构建使用 network=none，改变了旧下载RUN缓存条件，DOWNLOAD_NETWORK exit1。改回原构建参数network=default后下载层显示CACHED，没有重下载；构建exit0，新镜像 `ev-codex-auth:0.146.0-20260916-c2`、ID `sha256:abab7f91703ef45f647bfc2f256986213c9bd9e35affaa09c6cd81ab427a8ec7`。这是操作参数纠正，不是代码修复。构建阶段仅清理固定镜像自己产生的 /home/ev-codex/tmp，验证路径不为symlink且home仅含tmp后操作；不触碰宿主/卷。
- 主使用该镜像、network none、UID65532、只读根、cap-drop ALL、no-new-privileges、64pids/256MiB、64MiB noexec tmpfs运行 `python -B -m unittest discover -s /usr/local/lib/ev-codex -p test_auth_transport.py -v`，exit0、1/1 PASS、0.015s。预期拒绝类别AUTHORITY_REJECTED/METHOD_REJECTED/DNS_REJECTED出现在stderr，无任意输入/凭据。此测试是Fake sockets，不是真实TLS/登录。
- 审查快照见 `2026-09-16-codex-c2-review.md`。最终五hash：gateway B4389933EDA3CBD7F61189A79773ECC6EBD6D652A5AA54AE172AE7F3165BBCC9；client F6A1837EDA9A0C0025065ED0CFDB2C6C3608F8FC00324F5F68FD87189147E6C5；test 7EA08F0CEC205552239A3F2E4A3BFDC6ABAE7FF1E52CB2AAF6793D4E4931EEB7；Dockerfile EB2E85AC53D5C9087306E39BA797DABC900CA7129A7E5EBB7D07F5CF9E167F94；ignore 56A8DA31DBB9DB92595C55A67AAC8F58C0DAF0C04980F6133D5E3AEA613F14E7。
- Terra交回冻结声明：无待写代码，`py -3.11 -B scripts/codex-container/test_auth_transport.py` exit0、1/1 PASS；三Python文件语法解析通过。其最初RED是gateway文件尚不存在引发FileNotFoundError（exit1），**不是业务断言失败，不计作有效的行为RED证据**；当前成功与拒绝断言有实际GREEN及主容器复验，不夸大TDD完成程度。
- 初始独立复核 Planck NO-GO（原测试证据仍有效）：P2-1 `auth-client.py:267` 先要求socket文件不存在，Docker SIGTERM可能留下已失效socket，导致停网关检查误报；应真实尝试有界CONNECT并要求关闭，主另外inspect网关已停止。P2-2 DNS/多地址重试没有共同10秒deadline，relay阻塞I/O未夹紧剩余时限，login 600秒后再加10秒清理，bridge.close未主动关闭工作连接。违反冻结的总时限契约；进入R1/2局部修复，不启动登录。不得用扩大timeout/放宽网络使检查通过。
- 主在network none、非root只读容器中只读挂载新transport卷，验证自动copy-up后UID65532/mode0700；镜像home也为65532/0700且为空，exit0。未创建真实认证卷。Astra medium Planck `01a0a9a6-4543-7fd1-88bd-1b5d073801a6` 限定代码复核进行中，尚未登录或真实TLS连接。

### R1 局部修复证据

- Terra报告行为RED：`py -3.11 -B scripts/codex-container/test_auth_transport.py` exit1、2cases，stale socket触发CLOSED_GATEWAY_PRESENT错误，超期DNS未返回504导致失败；0.023s。R1 GREEN同命令exit0、2/2、0.026s；三Python文件AST解析通过。主独立运行同一两case exit0、2/2、0.026s；仅预期固定拒绝类别输出。没有全量测试。
- 主构建 `docker --context desktop-linux build --pull=false --network=default --label ev.component=codex --tag ev-codex-auth:0.146.0-20260916-c2-r1 scripts/codex-container` exit0、下载层CACHED，镜像ID `sha256:d7943f63aa9a1ec313efdf56fefbef09089cd4e2bf61a4e2bf3a88fe82abfa19`。
- 主核对R1三hash与实施者一致：gateway `23519DBDCD5ADDC22F8CA19420AD09031FD5F45882B5900E4C5C81D5BEEF9C2A`；client `DDE6D269F0FF132E7AA8D5C08DB2A5C37CB041F76F58AC9F358DB862E859D95F`；test `08B2FC0BFFD7AE017DEA1C203EC2106FE18F5C469643BE7A352717A1956EA994`。Dockerfile/ignore未变。增量修复diff见 `2026-09-16-codex-c2-r1.diff`。
- 实施者已交回且无待写源代码；独立Astra仅复核原两问题及修复引入的问题。真实TLS/登录仍未运行，不以GREEN代替联网证据。

### R1 独立复审与无凭据运行

Planck限定复审：stale socket探针和deadline问题均已解决，修复diff没有新增阻断；允许无凭据TLS探针，只有实际门禁通过才允许官方设备码登录。Fake证据不覆盖真实TLS/进程超时/背压；未再运行测试。

使用R1镜像创建 `ev-codex-auth-gateway-20260916-c2`：UID65532、专属bridge网络、read-only根、cap-drop ALL、no-new-privileges、64pids/128MiB/1CPU、32MiB noexec tmpfs；仅RW挂载专属transport卷。Python `-B /usr/local/lib/ev-codex/auth-gateway.py`，无auth卷/主机端口/宿主目录/Docker socket。启动exit0。

客户端 `ev-codex-auth-probe-20260916-c2`：同一R1镜像/UID65532，network none、read-only根、cap-drop ALL、no-new-privileges、64pids/256MiB/1CPU、64MiB noexec tmpfs，只读挂同一transport卷。执行 `python -B /usr/local/lib/ev-codex/auth-client.py --probe` exit1，固定 `PROXY_CONNECT_REJECTED`。网关仅输出固定 `DNS_REJECTED`，没有原始HTTP头/隧道/凭据。

在该网关中仅运行固定域名的getaddrinfo：`auth.openai.com:443` 返回 `[('198.18.0.79', False)]`（False为ipaddress.is_global）。之后仅一个临时诊断容器指定 `--dns 1.1.1.1`，保持相同专属网络/非root/read-only/cap-drop、无卷/凭据，带12s alarm查询相同域名，exit0、结果相同。该动作只覆盖一次诊断容器DNS，不修改系统、Docker全局或代理配置。疑似代理Fake-IP是推断，不是已核验的具体代理配置。

两实际容器inspect确认镜像均为R1 ID，网关network专属bridge、client=none；Mounts都只有transport卷，网关RW=true、clientRW=false；PortBindings={}、UID65532、只读根和隔离flags一致。认证卷尚未创建。

执行 `docker --context desktop-linux stop --timeout 3 ev-codex-auth-gateway-20260916-c2` exit0，随后inspect为`exited false 137`（停止超时后Docker终止），明确网关不再运行。新的 `ev-codex-auth-closed-20260916-c2` 使用客户端相同限制/只读transport卷，执行 `python -B /usr/local/lib/ev-codex/auth-client.py --probe-closed` exit0，`auth probe closed: PASS`。没有删除transport卷或残留socket来制造通过；停止后拒绝路径有真实证据。

本轮停止时网关已停止、无登录进程/真实模型请求。R1测试与隔离配置通过，不等同完整C2通过。TLS探针在DNS策略处提前停止，因此证书握手、真实非法目标403分支、CLI代理兼容、账号授权与认证持久化均NOT RUN。下一步需要确认用户代理/TUN/Fake-IP环境，不放宽私网IP策略、不暗改全局设置、不复制现有认证。旧镜像、停止的三个EV检查容器、专属网络及transport卷保留供追溯。
