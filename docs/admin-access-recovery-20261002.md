# 最小運用の管理画面・認可確認の復旧契約

GOAL ID：CARELINK-ADMIN-ACCESS-RECOVERY-20261002、revision 2。認可DB障害の検証と過去操作の成否を否定しない復帰文言を具体化した。経営条件と対象範囲は変更しない。
原依頼は認証済みtask contextの「優先順位つけて上から順に進めて全部解決させて」「再開」。原依頼のmessage IDは公開されていないため作成しない。
共通規則はr44、manifest SHA-256 `dd7b573c7d937373e19e5c038a1588a40a5ba764b164893b98510b7c0698e51d`。
開始HEADは`372b0d0be00d3316b16d2edef27c4bb553a32a17`。PR #659の認証API修正を引き継ぎ、開始時に未commit変更はない。別checkoutの変更は保持する。

## 目的と範囲

認証サービスの障害、認証後の認可DB障害を、未ログイン・非所属・404・空画面と誤判定しない。権限を許可せず、明示した再確認へつなげる。

対象はAdminShell、登録審査layout、予約一覧SSR、基本設定のbrowser読取／PATCH、予約調整依頼、通知受理の照合APIと関連検証。共通SDK instance methodの上書きはSDK内部呼出しまで変更するため採用しない。直接の呼出元へ既存verifyAuthUserを適用する。

掲載と予約の分離、1owner/1施設、tenantとplatform権限、CSRF・rate-limitの順序、業務操作ID、外部送信・受理照合の規則を保持する。migration・権限付与・実顧客の申込／返信・送信テスト・追加費用は含めない。決済・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除は引き続き保留。

## 原要求から検証への対応

| ID | 受入条件 | 実装・必須証拠 |
|---|---|---|
| A01 | 店舗管理のAuth確認不能をloginへredirectしない | AdminShellの明示fallback、認可照会ゼロ、正常／真正未認証の回帰 |
| A02 | membership/profileのDB失敗を非所属／404としない | dataとerrorの併存も拒否、子画面・業務情報を描画しない。正常profile/membershipの境界 |
| A03 | 予約一覧・審査layoutの再Auth障害を404としない | 明示fallback、後段読取ゼロ。認可DBのerror／throw／data＋errorも業務描画しない。確定権限なしの拒否は維持 |
| A04 | 設定画面のAuth障害を施設なしとしない | 既存LoadErrorと明示retry、施設選択query保持、正常再取得、保存開始ゼロ。施設選択のthrowもLoadError |
| A05 | 設定・調整・通知照合APIのAuth障害を401としない | Authは503/no-store、固定診断。認可DBのerror／throw／data＋errorは既存の固定500又は503で拒否し、業務書込み・送信・照合ゼロ。正常と真正未認証／非所属の区別を維持 |
| A06 | layout自体の障害を同階層error.tsxだけに委ねない | 明示alertと現在documentのGET再読込、query保持をブラウザ検証。POSTを自動再送せず、直前の操作結果まで変更なしと断定しない |
| A07 | 最新版を安全に本番へ反映する | 固定snapshot独立レビュー、必須CI、保護merge、deploy SHA・health・安全なprobe |

## 準備・安全判断

現行SDKの戻り値を親が直接確認し、上記の呼出元がerrorを未読／全errorを401へ変換することを確認した。独立した設計反証でも同経路を確認した。Next.jsの同segment error.tsxはlayout自身の例外を捕捉しないため、単なるthrowとresetではなく、明示fallbackと現在URLのdocument再読込を選ぶ。公開情報、Cookie、資格情報、raw errorはfallbackへ渡さない。

技術変更はAuth・認可境界の高risk変更として扱う。権限取得をskipする代替、getSession/cacheによる認証代替、未送信の成功表示、業務自動再試行は禁止する。別のlegacy／browser経路まで全て直ったとは報告せず、今回のcallerを固定して追跡する。

Quality Acceptance Matrixは機能正確性、失敗時UX・accessibility、security/privacy、復旧、信頼性、保守性、費用、既存事業方針を適用する。経営判断・法的契約・ブランド方針の変更はない。

必須gateは対象正常／異常／境界／権限／副作用ゼロ、負の対照、全体coverage branches 100％、lint・型・debt ratchet、静的／隔離DB Contract、production build・対象E2E、Security、固定snapshot独立レビュー、最新SHAのCI、merge後deploy／health／変更対象probe。SDK・UIの隔離検証を本番Auth障害注入やSMTP実送達の証拠と呼ばない。

完了は今回の全受入条件・必須gate・対象P0〜P3ゼロ・blocking unknownゼロで認定する。CareLink全体の完了は別判定とする。問題時はprovider-nativeで直前の検証済みdeployへ復帰し、別の検証済みPRで修正する。DB変更はない。

## 初回CI失敗と検証fixtureの修正

PR #660のHEAD `cdf6ae3ed8c407e1fd468de222305eecd3a8dfba`、CI `36979966885`は型・lint・単体9366件／coverage・Security・静的Contract・隔離実API Contract・production buildが成功したが、E2Eは314件成功・2件失敗で全体不合格。固定プロフィールの再INSERTは`birth_md`だけを除外し、もう一つのGENERATED ALWAYS列`email_canonical`を含んでいたため、復元とfinallyが失敗した。隔離PG17の実catalogと原票を照合して両生成列を特定した。

元workspaceや本番のprofile・認可・schemaは変更しない。両生成列は入力列からDBが再計算するため、合成actorの復元payloadからのみ除外する。元の全row一致、同queryのGET復帰、権限拒否、業務mutationゼロのassertは保持する。旧runを成功へ置換せず、変更後の固定版独立レビューと最新SHAの全必須CIへ戻す。

所有する隔離PG17で、旧payloadが`generated_always`（SQLSTATE 428C9）で拒否される負の対照と、両生成列を除いた復元後の全row一致を確認した。BEGIN／DO／ROLLBACKが成功し、合成actorも残さない。このSQL証拠だけでブラウザ復帰の成功とはせず、両browserの最新E2Eを別gateとして維持する。
