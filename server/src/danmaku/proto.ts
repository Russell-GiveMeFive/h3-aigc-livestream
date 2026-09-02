/**
 * Douyin Live WebSocket Protocol — Protobuf codec
 *
 * 反编译来源：抖音直播间 wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/
 * 参考 douyin.proto（DouyinLiveWebFetcher 项目，字段顺序与抖音服务端一致）。
 *
 * 协议结构：
 *   PushFrame (frame, wss 协议层)
 *     → payload (bytes, gzip 后)
 *       → Response (gzip 解压后)
 *         → Messages[] (push messages)
 *           → ChatMessage / GiftMessage / ...
 */

import protobuf from 'protobufjs'

// 用 protobufjs 的 JSON 反射加载（不需要 protoc，构建期零依赖）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCHEMA: any = {
  nested: {
    douyin: {
      nested: {
        webcast: {
          nested: {
            im: {
              nested: {
                PushFrame: {
                  fields: {
                    seqId: { type: 'uint64', id: 1 },
                    logId: { type: 'uint64', id: 2 },
                    service: { type: 'uint64', id: 3 },
                    method: { type: 'uint64', id: 4 },
                    headersList: {
                      rule: 'repeated',
                      type: 'HeadersList',
                      id: 5,
                    },
                    payloadEncoding: { type: 'string', id: 6 },
                    payloadType: { type: 'string', id: 7 },
                    payload: { type: 'bytes', id: 8 },
                  },
                  nested: {
                    HeadersList: {
                      fields: {
                        key: { type: 'string', id: 1 },
                        value: { type: 'string', id: 2 },
                      },
                    },
                  },
                },
                Response: {
                  fields: {
                    messagesList: {
                      rule: 'repeated',
                      type: 'Message',
                      id: 1,
                    },
                    cursor: { type: 'string', id: 2 },
                    fetchInterval: { type: 'uint64', id: 3 },
                    now: { type: 'uint64', id: 4 },
                    internalExt: { type: 'string', id: 5 },
                    fetchType: { type: 'uint32', id: 6 },
                    needAck: { type: 'bool', id: 9 },
                    pushServer: { type: 'string', id: 10 },
                    liveCursor: { type: 'string', id: 11 },
                    historyNoMore: { type: 'bool', id: 12 },
                  },
                },
                Message: {
                  fields: {
                    method: { type: 'string', id: 1 },
                    payload: { type: 'bytes', id: 2 },
                    msgId: { type: 'int64', id: 3 },
                    msgType: { type: 'int32', id: 4 },
                  },
                },
                Common: {
                  fields: {
                    method: { type: 'string', id: 1 },
                    msgId: { type: 'uint64', id: 2 },
                    roomId: { type: 'uint64', id: 3 },
                    createTime: { type: 'uint64', id: 4 },
                    monitor: { type: 'uint32', id: 5 },
                    isShowMsg: { type: 'bool', id: 6 },
                    describe: { type: 'string', id: 7 },
                    foldType: { type: 'uint64', id: 9 },
                    anchorFoldType: { type: 'uint64', id: 10 },
                    priorityScore: { type: 'uint64', id: 11 },
                    logId: { type: 'string', id: 12 },
                    msgProcessFilterK: { type: 'string', id: 13 },
                    msgProcessFilterV: { type: 'string', id: 14 },
                    user: { type: 'User', id: 15 },
                    anchorFoldTypeV2: { type: 'uint64', id: 17 },
                    processAtSeiTimeMs: { type: 'uint64', id: 18 },
                    randomDispatchMs: { type: 'uint64', id: 19 },
                    isDispatch: { type: 'bool', id: 20 },
                    channelId: { type: 'uint64', id: 21 },
                    diffSei2absSecond: { type: 'uint64', id: 22 },
                    anchorFoldDuration: { type: 'uint64', id: 23 },
                  },
                },
                Image: {
                  fields: {
                    urlList: { rule: 'repeated', type: 'string', id: 1 },
                    uri: { type: 'string', id: 2 },
                    height: { type: 'int32', id: 3 },
                    width: { type: 'int32', id: 4 },
                    avgColor: { type: 'string', id: 5 },
                    imageType: { type: 'int32', id: 6 },
                    openWebUrl: { type: 'string', id: 7 },
                    fileSize: { type: 'string', id: 8 },
                    hash: { type: 'string', id: 9 },
                  },
                },
                User: {
                  fields: {
                    id: { type: 'uint64', id: 1 },
                    shortId: { type: 'uint64', id: 2 },
                    nickName: { type: 'string', id: 3 },
                    gender: { type: 'uint32', id: 4 },
                    signature: { type: 'string', id: 5 },
                    level: { type: 'uint32', id: 6 },
                    birthday: { type: 'uint64', id: 7 },
                    telephone: { type: 'string', id: 8 },
                    avatarThumb: { type: 'Image', id: 9 },
                    avatarMedium: { type: 'Image', id: 10 },
                    avatarLarge: { type: 'Image', id: 11 },
                    verified: { type: 'bool', id: 12 },
                    experience: { type: 'uint32', id: 13 },
                    city: { type: 'string', id: 14 },
                    status: { type: 'int32', id: 15 },
                    createTime: { type: 'uint64', id: 16 },
                    modifyTime: { type: 'uint64', id: 17 },
                    secret: { type: 'uint32', id: 18 },
                    shareQrcodeUri: { type: 'string', id: 19 },
                    incomeSharePercent: { type: 'uint32', id: 20 },
                    displayId: { type: 'string', id: 38 },
                    secUid: { type: 'string', id: 46 },
                    fanTicketCount: { type: 'uint64', id: 1022 },
                  },
                },
                ChatMessage: {
                  fields: {
                    common: { type: 'Common', id: 1 },
                    user: { type: 'User', id: 2 },
                    content: { type: 'string', id: 3 },
                    visibleToSender: { type: 'bool', id: 4 },
                    backgroundImage: { type: 'Image', id: 5 },
                    fullScreenTextColor: { type: 'string', id: 6 },
                    backgroundImageV2: { type: 'Image', id: 7 },
                    publicAreaCommon: { type: 'PublicAreaCommon', id: 9 },
                    giftImage: { type: 'Image', id: 10 },
                    agreeMsgId: { type: 'uint64', id: 11 },
                    priorityLevel: { type: 'uint32', id: 12 },
                    landscapeAreaCommon: { type: 'LandscapeAreaCommon', id: 13 },
                    eventTime: { type: 'uint64', id: 15 },
                    sendReview: { type: 'bool', id: 16 },
                    fromIntercom: { type: 'bool', id: 17 },
                    intercomHideUserCard: { type: 'bool', id: 18 },
                    chatBy: { type: 'string', id: 20 },
                  },
                  nested: {
                    PublicAreaCommon: {
                      fields: {
                        userLabel: { type: 'UserLabel', id: 1 },
                        isOfficial: { type: 'bool', id: 2 },
                        isAuthor: { type: 'bool', id: 3 },
                      },
                      nested: {
                        UserLabel: {
                          fields: {
                            labelType: { type: 'uint32', id: 1 },
                            url: { type: 'string', id: 2 },
                          },
                        },
                      },
                    },
                    LandscapeAreaCommon: {
                      fields: {
                        backgroundColor: { type: 'string', id: 1 },
                      },
                    },
                  },
                },
                MemberMessage: {
                  fields: {
                    common: { type: 'Common', id: 1 },
                    user: { type: 'User', id: 2 },
                    memberCount: { type: 'int64', id: 3 },
                    action: { type: 'string', id: 4 },
                    anchorDisplay: { type: 'bool', id: 5 },
                    popStr: { type: 'string', id: 6 },
                    eventTime: { type: 'int64', id: 7 },
                    userEnterTipType: { type: 'int32', id: 8 },
                    publicAreaCommon: { type: 'PublicAreaCommon', id: 9 },
                  },
                  nested: {
                    PublicAreaCommon: {
                      fields: {
                        userLabel: { type: 'UserLabel', id: 1 },
                      },
                      nested: {
                        UserLabel: {
                          fields: {
                            labelType: { type: 'uint32', id: 1 },
                            url: { type: 'string', id: 2 },
                          },
                        },
                      },
                    },
                  },
                },
                LikeMessage: {
                  fields: {
                    common: { type: 'Common', id: 1 },
                    user: { type: 'User', id: 2 },
                    total: { type: 'int64', id: 3 },
                    count: { type: 'int64', id: 4 },
                    likeCount: { type: 'int64', id: 5 },
                    userId: { type: 'string', id: 6 },
                    scene: { type: 'string', id: 7 },
                    eventTime: { type: 'int64', id: 8 },
                    publicAreaCommon: { type: 'PublicAreaCommon', id: 9 },
                  },
                  nested: {
                    PublicAreaCommon: {
                      fields: {
                        userLabel: { type: 'UserLabel', id: 1 },
                      },
                      nested: {
                        UserLabel: {
                          fields: {
                            labelType: { type: 'uint32', id: 1 },
                            url: { type: 'string', id: 2 },
                          },
                        },
                      },
                    },
                  },
                },
                SocialMessage: {
                  fields: {
                    common: { type: 'Common', id: 1 },
                    user: { type: 'User', id: 2 },
                    followCount: { type: 'int64', id: 3 },
                    action: { type: 'string', id: 4 },
                    shareLevel: { type: 'uint32', id: 5 },
                    eventTime: { type: 'int64', id: 6 },
                    publicAreaCommon: { type: 'PublicAreaCommon', id: 7 },
                  },
                  nested: {
                    PublicAreaCommon: {
                      fields: {
                        userLabel: { type: 'UserLabel', id: 1 },
                      },
                      nested: {
                        UserLabel: {
                          fields: {
                            labelType: { type: 'uint32', id: 1 },
                            url: { type: 'string', id: 2 },
                          },
                        },
                      },
                    },
                  },
                },
                Gift: {
                  fields: {
                    id: { type: 'uint64', id: 1 },
                    name: { type: 'string', id: 2 },
                    describe: { type: 'string', id: 3 },
                    diamondCount: { type: 'int64', id: 4 },
                    isRandom: { type: 'bool', id: 5 },
                    isForDraw: { type: 'bool', id: 6 },
                    giftCount: { type: 'int64', id: 7 },
                    giftType: { type: 'int32', id: 8 },
                    image: { type: 'Image', id: 9 },
                  },
                },
                GiftMessage: {
                  fields: {
                    common: { type: 'Common', id: 1 },
                    user: { type: 'User', id: 2 },
                    gift: { type: 'Gift', id: 3 },
                    giftId: { type: 'uint64', id: 4 },
                    repeatCount: { type: 'int64', id: 5 },
                    groupCount: { type: 'int32', id: 6 },
                    repeatEnd: { type: 'uint64', id: 7 },
                    timestamp: { type: 'int64', id: 8 },
                    logId: { type: 'int64', id: 9 },
                    sendReview: { type: 'bool', id: 10 },
                    publicAreaCommon: { type: 'PublicAreaCommon', id: 11 },
                    eventTime: { type: 'int64', id: 12 },
                  },
                  nested: {
                    PublicAreaCommon: {
                      fields: {
                        userLabel: { type: 'UserLabel', id: 1 },
                      },
                      nested: {
                        UserLabel: {
                          fields: {
                            labelType: { type: 'uint32', id: 1 },
                            url: { type: 'string', id: 2 },
                          },
                        },
                      },
                    },
                  },
                },
                RoomUserSeqMessage: {
                  fields: {
                    common: { type: 'Common', id: 1 },
                    total: { type: 'int64', id: 2 },
                    totalUser: { type: 'int64', id: 3 },
                    pushServer: { type: 'string', id: 4 },
                    fanTickets: { type: 'string', id: 5 },
                    anchorNickname: { type: 'string', id: 6 },
                    roomId: { type: 'uint32', id: 7 },
                    ranksList: { rule: 'repeated', type: 'RankItem', id: 8 },
                  },
                },
                RankItem: {
                  fields: {
                    user: { type: 'User', id: 1 },
                    rank: { type: 'uint32', id: 2 },
                    score: { type: 'int64', id: 3 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
const root = protobuf.Root.fromJSON(SCHEMA)

export const PushFrame = root.lookupType('douyin.webcast.im.PushFrame')
export const Response = root.lookupType('douyin.webcast.im.Response')
export const Message = root.lookupType('douyin.webcast.im.Message')
export const ChatMessage = root.lookupType('douyin.webcast.im.ChatMessage')
export const MemberMessage = root.lookupType('douyin.webcast.im.MemberMessage')
export const LikeMessage = root.lookupType('douyin.webcast.im.LikeMessage')
export const SocialMessage = root.lookupType('douyin.webcast.im.SocialMessage')
export const GiftMessage = root.lookupType('douyin.webcast.im.GiftMessage')
export const RoomUserSeqMessage = root.lookupType('douyin.webcast.im.RoomUserSeqMessage')
