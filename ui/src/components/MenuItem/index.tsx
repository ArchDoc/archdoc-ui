import { Info } from '@icon-park/react';
import Icon, {ALL_ICON_KEYS, IconType} from '@icon-park/react/es/all';
import './index.css';

interface Props {
    icon: IconType,
    title: string
}

export const MenuItem = ({icon, title}: Props) => {
    return (
        <div className='MenuItem'>
          <Icon type={icon} theme="filled" size="38" fill="#E9E9E9" strokeWidth={3}/>
          <span>{title}</span>
        </div>
    )
}