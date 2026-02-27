'use client';
import {
    Attachments,
    Bubble,
    BubbleProps,
    Conversations,
    Prompts,
    Sender,
    Welcome,
    useXAgent,
    useXChat,
  } from '@ant-design/x';
import React, { useEffect } from 'react';
import {
  CloudUploadOutlined,
  CommentOutlined,
  EllipsisOutlined,
  FireOutlined,
  HeartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReadOutlined,
  ShareAltOutlined,
  SmileOutlined,
} from '@ant-design/icons';
import { Badge, Button, Space } from 'antd';
import type { UploadChangeParam, UploadFile } from 'antd/es/upload';
import { useStyle } from './styles/independent.styles';

const renderTitle = (icon: React.ReactNode, title: string) => (
    <Space align="start">
      {icon}
      <span>{title}</span>
    </Space>
  );

const defaultConversationsItems = [
    {
      key: '0',
      label: '怎麼使用臺鐵AI智能助手?',
    },
  ];

const placeholderPromptsItems = [
  {
    key: '1',
    label: renderTitle(
      <FireOutlined style={{ color: '#FF4D4F' }} />,
      '常見問題',
    ),
    description: '系統最常見問題',
    children: [
      { key: '1-1', description: `怎麼使用臺鐵AI智能助手?` },
      // { key: '1-2', description: `怎麼使用臺鐵AI智能助手?` },
      // { key: '1-3', description: `怎麼使用臺鐵AI智能助手?` },
    ],
  },
  {
    key: '2',
    label: renderTitle(
      <ReadOutlined style={{ color: '#1890FF' }} />,
      '車輛檢修相關',
    ),
    description: '車輛檢修/臨修/動態/可用率相關問題?',
    children: [
      { key: '2-1', icon: <HeartOutlined />, description: `EMU901上次2A維修時間` },
      { key: '2-2', icon: <SmileOutlined />, description: `最近一次A級故障通報時間與資訊?` },
      { key: '2-3', icon: <CommentOutlined />, description: `本日動力車輛可用率是多少` },
    ],
  },
  {
    key: '3',
    label: renderTitle(
      <ReadOutlined style={{ color: '#1890FF' }} />,
      '物料相關問題',
    ),
    description: '檢修用料/庫存量/近期異動明細?',
    children: [
      { key: '2-1', icon: <HeartOutlined />, description: `七堵機務段最近常領用物料資訊` },
      { key: '2-2', icon: <SmileOutlined />, description: `七堵機務段倉庫中是否有低於安全存的物料?` },
      { key: '2-3', icon: <CommentOutlined />, description: `前一個月庫存餘額總金額是多少` },
    ],
  },
  {
    key: '4',
    label: renderTitle(
      <ReadOutlined style={{ color: '#1890FF' }} />,
      '其他',
    ),
    description: '檢修用料/庫存量/近期異動明細?',
    children: [
      { key: '2-1', icon: <HeartOutlined />, description: `七堵機務段最近常領用物料資訊` },
      { key: '2-2', icon: <SmileOutlined />, description: `七堵機務段倉庫中是否有低於安全存的物料?` },
      { key: '2-3', icon: <CommentOutlined />, description: `前一個月庫存餘額總金額是多少` },
    ],
  },
];

const senderPromptsItems = [
  {
    key: '1',
    description: 'Hot Topics',
    icon: <FireOutlined style={{ color: '#FF4D4F' }} />,
  },
  {
    key: '2',
    description: 'Design Guide',
    icon: <ReadOutlined style={{ color: '#1890FF' }} />,
  },
];

const roles: Record<string, Partial<Omit<BubbleProps, "content">>> = {
  ai: {
    placement: 'start',
    typing: {
      step: 5,
      interval: 20,
    },
    styles: {
      content: {
        borderRadius: 16,
      },
    },
  },
  local: {
    placement: 'end',
    variant: 'shadow',
  },
};

const Independent = () => {
    const { styles } = useStyle();
    const [headerOpen, setHeaderOpen] = React.useState(false);
    const [menuExpanded, setMenuExpanded] = React.useState(false);
    const [menuCollapsed, setMenuCollapsed] = React.useState(false);
    const [content, setContent] = React.useState('');
    const [conversationsItems, setConversationsItems] = React.useState(defaultConversationsItems);
    const [activeKey, setActiveKey] = React.useState(defaultConversationsItems[0].key);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [attachedFiles, setAttachedFiles] = React.useState<UploadFile<any>[]>([]);
  
    // ==================== Runtime ====================
    const [agent] = useXAgent({
      request: async ({ message }, { onSuccess }) => {
        onSuccess(`Mock success return. You said: ${message}`);
      },
    });
    const { onRequest, messages, setMessages } = useXChat({
      agent,
    });
    useEffect(() => {
      if (activeKey !== undefined) {
        setMessages([]);
      }
    }, [activeKey]);
  
    // ==================== Event ====================
    const onSubmit = (nextContent: string) => {
      if (!nextContent) return;
      onRequest(nextContent);
      setContent('');
    };
    const onPromptsItemClick = (info: { data: { description?: string | React.ReactNode } }) => {
      if (info.data.description) {
        onRequest(info.data.description.toString());
      }
    };
    const onAddConversation = () => {
      setConversationsItems([
        ...conversationsItems,
        {
          key: `${conversationsItems.length}`,
          label: `New Conversation ${conversationsItems.length}`,
        },
      ]);
      setActiveKey(`${conversationsItems.length}`);
    };
    const onConversationClick = (key: string) => {
      setActiveKey(key);
    };
    const handleFileChange = (info: UploadChangeParam<UploadFile>) => setAttachedFiles(info.fileList);
  
    // ==================== Nodes ====================
    const placeholderNode = (
      <Space direction="vertical" size={16} className={styles.placeholder}>
        <Welcome
          variant="borderless"
          icon="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp"
          title="Hello, I'm Ant Design X"
          description="Base on Ant Design, AGI product interface solution, create a better intelligent vision~"
          extra={
            <Space>
              <Button icon={<ShareAltOutlined />} />
              <Button icon={<EllipsisOutlined />} />
            </Space>
          }
        />
        <Prompts
          title="你可以問我"
          items={placeholderPromptsItems}
          styles={{
            list: {
              width: '100%',
            },
            item: {
              flex: 1,
            },
          }}
          onItemClick={onPromptsItemClick}
        />
      </Space>
    );
    const items = messages.map(({ id, message, status }) => ({
      key: id,
      loading: status === 'loading',
      role: status === 'local' ? 'local' : 'ai',
      content: message,
    }));
    const attachmentsNode = (
      <Badge dot={attachedFiles.length > 0 && !headerOpen}>
        <Button type="text" icon={<PaperClipOutlined />} onClick={() => setHeaderOpen(!headerOpen)} />
      </Badge>
    );
    const senderHeader = (
      <Sender.Header
        title="Attachments"
        open={headerOpen}
        onOpenChange={setHeaderOpen}
        styles={{
          content: {
            padding: 0,
          },
        }}
      >
        <Attachments
          beforeUpload={() => false}
          items={attachedFiles}
          onChange={handleFileChange}
          placeholder={(type) =>
            type === 'drop'
              ? {
                  title: 'Drop file here',
                }
              : {
                  icon: <CloudUploadOutlined />,
                  title: 'Upload files',
                  description: 'Click or drag files to this area to upload',
                }
          }
        />
      </Sender.Header>
    );
    const logoNode = (
      <div className={styles.logo}>
        <img
          src="/TR_logo.svg"
          draggable={false}
          alt="logo"
        />
        <span>TRA 臺鐵AI智能客服</span>
      </div>
    );
  
    const toggleMenu = () => {
      if (window.innerWidth <= 1024) {
        setMenuExpanded(!menuExpanded);
      } else {
        setMenuCollapsed(!menuCollapsed);
      }
    };
  
    const menuToggleNode = (
      <div 
        className={`${styles.menuToggle} ${menuCollapsed ? 'collapsed' : ''} ${menuExpanded ? 'expanded' : ''}`} 
        onClick={toggleMenu}
      >
        {window.innerWidth <= 1024 ? 
          (menuExpanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />) :
          (menuCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)
        }
      </div>
    );
  
    // 使用 useEffect 監聽視窗大小變化
    useEffect(() => {
      const handleResize = () => {
        if (window.innerWidth > 1024) {
          setMenuExpanded(false);
        }
      };

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, []);
  
    // ==================== Render =================
    return (
      <div className={styles.layout}>
        {menuToggleNode}
        <div className={`${styles.menu} ${menuExpanded ? 'expanded' : ''} ${menuCollapsed ? 'collapsed' : ''}`}>
          {logoNode}
          <Button
            onClick={onAddConversation}
            type="link"
            className={styles.addBtn}
            icon={<PlusOutlined />}
          >
            新增對話視窗
          </Button>
          <Conversations
            items={conversationsItems}
            className={styles.conversations}
            activeKey={activeKey}
            onActiveChange={onConversationClick}
          />
        </div>
        <div className={`${styles.chat} ${menuCollapsed ? 'menu-collapsed' : ''}`}>
          <Bubble.List
            items={
              items.length > 0
                ? items
                : [
                    {
                      content: placeholderNode,
                      variant: 'borderless',
                    },
                  ]
            }
            roles={roles}
            className={styles.messages}
          />
          <Prompts 
            items={senderPromptsItems} 
            onItemClick={onPromptsItemClick}
            styles={{
              list: {
                gap: window.innerWidth <= 768 ? 8 : 16,
              }
            }}
          />
          <Sender
            value={content}
            header={senderHeader}
            onSubmit={onSubmit}
            onChange={setContent}
            prefix={attachmentsNode}
            loading={agent.isRequesting()}
            className={styles.sender}
          />
        </div>
      </div>
    );
  };
  export default Independent;