import { ArrowRight } from '@icon-park/react'
import './index.css'

interface Props {
    component: string
    description: string
    onComponentClick: (component: string) => void
}

export const UsageSummary = ({component, description, onComponentClick}: Props) => {
    return <div className='UsageSummary'>
        <div>
            <div className='component'>
                <span className='component-icon'></span>
                <a href='#' onClick={() => onComponentClick(component)}>{component}</a>
            </div>
        </div>
        <div>
            <ArrowRight theme="filled" size="28" fill="#333" strokeWidth={3}/>
        </div>
        <div>
            <p className='description'>{description}</p>
        </div>
    </div>
}